import {
  computeHostSubmitDueAt,
  computePostDeadlineHostSubmitDueAt,
  HOST_POST_DEADLINE_RETRY_WINDOW_HOURS,
  isPostDeadlineHostSubmitKey,
  postDeadlineHostSubmitIdempotencyKey,
} from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { logError, logInfo } from "@/lib/log";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/admin";
import { emitDomainEvent } from "@/server/notifications/service";
import { recordApplicationEvent } from "@/services/platform";

import { freezeApplicationPacket } from "./freeze-packet";
import {
  shouldContinueHostFill,
  shouldCreateNewAutoSubmitJob,
  shouldQueuePostDeadlineRetry,
  summarizeHostSubmitJobs,
  isManualHostSubmitKey,
  type HostJobLite,
  type HostSubmitAttemptState,
} from "./host-submit-policy";

export type HostSubmitJobKind = "prefill" | "submit";

export type HostSubmitJobRow = {
  id: string;
  application_id: string;
  source_url: string;
  due_at: string;
  status: string;
  attempt_count: number;
  job_kind: HostSubmitJobKind;
  idempotency_key?: string;
};

function publicFormUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const CLOSED_APPLICATION_STATUSES = new Set(["submitted", "rejected", "withdrawn", "archived", "offer"]);

async function loadApplicationContext(
  supabase: SupabaseClient,
  actor: Actor,
  applicationId: string,
) {
  const { data: application } = await supabase
    .from("applications")
    .select("id, status, deadline_at, opportunity_id, opportunities ( source_url, canonical_url, title )")
    .eq("id", applicationId)
    .eq("user_id", actor.userId)
    .maybeSingle();

  if (!application) return null;

  const opportunity = Array.isArray(application.opportunities)
    ? application.opportunities[0]
    : application.opportunities;
  const sourceUrl =
    publicFormUrl((opportunity as { canonical_url?: string | null } | null)?.canonical_url) ??
    publicFormUrl((opportunity as { source_url?: string | null } | null)?.source_url);

  return {
    application,
    opportunity,
    sourceUrl,
    closed: CLOSED_APPLICATION_STATUSES.has(String(application.status)),
  };
}

function hostContextUnavailableReason(
  ctx: Awaited<ReturnType<typeof loadApplicationContext>>,
  opts?: { allowClosed?: boolean },
): "not_found" | "already_submitted" | "no_source_url" | null {
  if (!ctx) return "not_found";
  if (ctx.closed && !opts?.allowClosed) return "already_submitted";
  if (!ctx.sourceUrl) return "no_source_url";
  return null;
}

export async function loadHostSubmitAttemptState(
  supabase: SupabaseClient,
  applicationId: string,
  application?: { status?: string | null; submitted_at?: string | null },
): Promise<HostSubmitAttemptState> {
  const [{ data: jobs }, appRow] = await Promise.all([
    supabase
      .from("host_submit_jobs")
      .select("status, job_kind, host_submit_clicked, last_error, idempotency_key")
      .eq("application_id", applicationId),
    application
      ? Promise.resolve({ data: application })
      : supabase.from("applications").select("status, submitted_at").eq("id", applicationId).maybeSingle(),
  ]);
  return summarizeHostSubmitJobs((jobs ?? []) as HostJobLite[], appRow.data ?? {});
}

async function upsertHostJob(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  sourceUrl: string;
  jobKind: HostSubmitJobKind;
  dueAt: Date;
  idempotencyKey: string;
  nextAction: string;
  eventTitle: string;
  eventBody: string;
  /** Re-open a Need You pause so the page-loop can resume. Never reopens a failed submit. */
  reopenIfComplete?: boolean;
  /** User tapped Resubmit — allow a new attempt even if earlier jobs failed. */
  forceManual?: boolean;
}): Promise<{ ok: true; jobId: string } | { ok: false; reason: string }> {
  const {
    supabase,
    actor,
    applicationId,
    sourceUrl,
    jobKind,
    dueAt,
    idempotencyKey,
    nextAction,
    eventTitle,
    eventBody,
    reopenIfComplete,
    forceManual,
  } = input;

  const queue = createServiceRoleSupabaseClient();

  const { data: existing } = await queue
    .from("host_submit_jobs")
    .select("id, status, last_error, host_submit_clicked, attempt_count, due_at")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) {
    const status = String(existing.status);
    const waitingNeedsYou =
      status === "completed" &&
      String(existing.last_error ?? "") === "waiting_needs_you" &&
      !existing.host_submit_clicked;

    if (["submitted", "blocked", "cancelled"].includes(status)) {
      return { ok: true, jobId: String(existing.id) };
    }
    if (status === "failed" && !forceManual) {
      return { ok: true, jobId: String(existing.id) };
    }
    if (status === "completed" && !(reopenIfComplete && waitingNeedsYou)) {
      return { ok: true, jobId: String(existing.id) };
    }
    if (status === "running") {
      return { ok: true, jobId: String(existing.id) };
    }

    const reopeningNeedsYou = Boolean(reopenIfComplete && waitingNeedsYou);
    if (status === "pending" && !reopeningNeedsYou && !forceManual) {
      const existingDue = Date.parse(String(existing.due_at ?? ""));
      // Already queued at least as soon as requested — dashboard sync must not bump due_at.
      if (!Number.isNaN(existingDue) && existingDue <= dueAt.getTime() + 1000) {
        return { ok: true, jobId: String(existing.id) };
      }
    }
    const { error: updateError } = await queue
      .from("host_submit_jobs")
      .update({
        due_at: dueAt.toISOString(),
        source_url: sourceUrl,
        status: "pending",
        job_kind: jobKind,
        ...(reopeningNeedsYou || forceManual
          ? { attempt_count: 0, last_error: null, completed_at: null }
          : {}),
      })
      .eq("id", existing.id);
    if (updateError) {
      logError("host_submit.reschedule_failed", { updateError, applicationId, idempotencyKey });
      return { ok: false, reason: updateError.message };
    }
    logInfo("host_submit.job_rescheduled", {
      applicationId,
      jobKind,
      jobId: String(existing.id),
      dueAt: dueAt.toISOString(),
      reopeningNeedsYou,
    });
    return { ok: true, jobId: String(existing.id) };
  }

  const { data: job, error } = await queue
    .from("host_submit_jobs")
    .insert({
      user_id: actor.userId,
      application_id: applicationId,
      source_url: sourceUrl,
      due_at: dueAt.toISOString(),
      status: "pending",
      job_kind: jobKind,
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .single();

  if (error || !job) {
    logError("host_submit.queue_insert_failed", { error, applicationId, jobKind, idempotencyKey });
    return { ok: false, reason: error?.message ?? "insert_failed" };
  }

  await supabase
    .from("applications")
    .update({ next_action: nextAction })
    .eq("id", applicationId)
    .eq("user_id", actor.userId);

  await emitDomainEvent(supabase, {
    name: "automation.host_submit",
    userId: actor.userId,
    applicationId,
    subjectId: `${applicationId}:host_${jobKind}`,
    title: eventTitle,
    body: eventBody,
  });

  logInfo("host_submit.job_queued", {
    applicationId,
    jobKind,
    jobId: String(job.id),
    dueAt: dueAt.toISOString(),
  });

  return { ok: true, jobId: String(job.id) };
}

const STALE_RUNNING_MS = 12 * 60 * 1000;

/** Reclaim jobs left in `running` after a worker crash or Playwright hang. */
export async function recoverStaleRunningHostJobs(supabase: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  const { data, error } = await supabase
    .from("host_submit_jobs")
    .update({
      status: "pending",
      last_error: "recovered_from_stale_running",
    })
    .eq("status", "running")
    .lt("updated_at", cutoff)
    .select("id");

  if (error) {
    logError("host_submit.recover_stale_failed", { error });
    return 0;
  }
  const count = data?.length ?? 0;
  if (count > 0) {
    logInfo("host_submit.recovered_stale_running", { count });
  }
  return count;
}

/**
 * On cron sweeps, re-queue submit jobs for open applications whose submit window
 * has started but whose job is missing, failed, or exhausted retries.
 * After the deadline, ensure a single post-deadline attempt if still not submitted.
 */
export async function reconcileOverdueHostSubmitJobs(supabase: SupabaseClient): Promise<number> {
  const { loadActorForUser } = await import("./host-submit-worker");
  const now = new Date();
  const windowStart = new Date(
    now.getTime() - HOST_POST_DEADLINE_RETRY_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const { data: applications, error } = await supabase
    .from("applications")
    .select("id, user_id, status, deadline_at, opportunities ( canonical_url, source_url )")
    .not("deadline_at", "is", null)
    .in("status", ["saved", "analyzing", "ready_to_apply", "in_progress", "review_required", "draft", "preparing", "ready"])
    .gte("deadline_at", windowStart)
    .lte("deadline_at", new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString())
    .limit(80);

  if (error) {
    logError("host_submit.reconcile_load_failed", { error });
    return 0;
  }

  let requeued = 0;
  for (const application of applications ?? []) {
    const deadlineAt = String(application.deadline_at);
    const deadlineMs = new Date(deadlineAt).getTime();
    if (Number.isNaN(deadlineMs)) continue;

    const opportunity = Array.isArray(application.opportunities)
      ? application.opportunities[0]
      : application.opportunities;
    const sourceUrl =
      publicFormUrl((opportunity as { canonical_url?: string | null } | null)?.canonical_url) ??
      publicFormUrl((opportunity as { source_url?: string | null } | null)?.source_url);
    if (!sourceUrl) continue;

    const actor = await loadActorForUser(supabase, String(application.user_id));
    if (!actor) continue;

    const pastDeadline = deadlineMs <= now.getTime();
    const state = await loadHostSubmitAttemptState(supabase, String(application.id), {
      status: String(application.status),
      submitted_at: null,
    });
    if (state.hostSubmitSucceeded || state.applicationSubmitted) continue;

    if (pastDeadline) {
      if (!shouldQueuePostDeadlineRetry(state)) continue;

      const postKey = postDeadlineHostSubmitIdempotencyKey(String(application.id), deadlineAt);
      const { data: postJob } = await supabase
        .from("host_submit_jobs")
        .select("id, status")
        .eq("idempotency_key", postKey)
        .maybeSingle();

      // One attempt after the deadline — do not reopen terminal outcomes.
      if (postJob && ["submitted", "failed", "blocked", "cancelled", "completed"].includes(String(postJob.status))) {
        continue;
      }
      if (postJob && ["pending", "running"].includes(String(postJob.status))) {
        continue;
      }

      const result = await upsertHostJob({
        supabase,
        actor,
        applicationId: String(application.id),
        sourceUrl,
        jobKind: "submit",
        dueAt: now,
        idempotencyKey: postKey,
        nextAction: "Deadline passed — trying one final host submit now.",
        eventTitle: "Final submit attempt after deadline",
        eventBody:
          "The form was not marked submitted by the deadline. 1-Apply will try one more time and notify you of the result.",
      });
      if (result.ok) requeued += 1;
      continue;
    }

    const dueAt = computeHostSubmitDueAt(deadlineAt, now);
    if (dueAt.getTime() > now.getTime()) continue;
    if (!shouldCreateNewAutoSubmitJob(state)) continue;

    const idempotencyKey = `${application.id}:host_submit:${deadlineAt}`;
    const { data: job } = await supabase
      .from("host_submit_jobs")
      .select("id, status, attempt_count, job_kind")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (job && ["submitted", "pending", "running", "blocked", "cancelled", "failed", "completed"].includes(String(job.status))) {
      continue;
    }

    const result = await upsertHostJob({
      supabase,
      actor,
      applicationId: String(application.id),
      sourceUrl,
      jobKind: "submit",
      dueAt: now,
      idempotencyKey,
      nextAction: "Auto-submit queued — filling and submitting the host form.",
      eventTitle: "Auto-submit queued",
      eventBody: "The server will fill and submit this form once before the deadline.",
    });
    if (result.ok) requeued += 1;
  }

  if (requeued > 0) {
    logInfo("host_submit.reconciled_overdue", { requeued });
  }
  return requeued;
}

/** Immediate server visit: inventory + fill all pages (no final Submit). */
export async function queueHostPrefillJob(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
}): Promise<{ ok: true; jobId: string } | { ok: false; reason: string }> {
  const ctx = await loadApplicationContext(input.supabase, input.actor, input.applicationId);
  const blocked = hostContextUnavailableReason(ctx);
  if (blocked) return { ok: false, reason: blocked };
  if (!ctx?.sourceUrl) return { ok: false, reason: "not_found" };

  return upsertHostJob({
    supabase: input.supabase,
    actor: input.actor,
    applicationId: input.applicationId,
    sourceUrl: ctx.sourceUrl,
    jobKind: "prefill",
    dueAt: new Date(),
    idempotencyKey: `${input.applicationId}:host_prefill`,
    nextAction: "Server prefill queued — fields will be filled from your profile shortly.",
    eventTitle: `Prefill queued — ${(ctx.opportunity as { title?: string } | null)?.title ?? "Application"}`,
    eventBody: "1-Apply will visit the form now and fill it from Application Memory. You can review before auto-submit.",
  });
}

/** Schedule final submit for 1 hour before the deadline (or immediately if deadline is sooner). */
export async function scheduleHostSubmitJob(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
}): Promise<{ ok: true; jobId: string } | { ok: false; reason: string }> {
  const ctx = await loadApplicationContext(input.supabase, input.actor, input.applicationId);
  const blocked = hostContextUnavailableReason(ctx);
  if (blocked) return { ok: false, reason: blocked };
  if (!ctx?.sourceUrl) return { ok: false, reason: "not_found" };

  const deadlineAt = (ctx.application.deadline_at as string | null) ?? null;
  if (!deadlineAt) return { ok: false, reason: "no_deadline" };

  const dueAt = computeHostSubmitDueAt(deadlineAt);
  const idempotencyKey = `${input.applicationId}:host_submit:${deadlineAt}`;
  const state = await loadHostSubmitAttemptState(input.supabase, input.applicationId, {
    status: String(ctx.application.status),
    submitted_at: null,
  });

  if (state.hostSubmitSucceeded || state.applicationSubmitted) {
    return { ok: false, reason: "already_submitted" };
  }

  let primary: { ok: true; jobId: string } | { ok: false; reason: string } = {
    ok: false,
    reason: "submit_already_attempted",
  };
  if (shouldCreateNewAutoSubmitJob(state)) {
    primary = await upsertHostJob({
      supabase: input.supabase,
      actor: input.actor,
      applicationId: input.applicationId,
      sourceUrl: ctx.sourceUrl,
      jobKind: "submit",
      dueAt,
      idempotencyKey,
      nextAction: `Auto-submit scheduled ${dueAt.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })} (1 hour before deadline).`,
      eventTitle: `Auto-submit scheduled — ${(ctx.opportunity as { title?: string } | null)?.title ?? "Application"}`,
      eventBody:
        "You'll get a review email up to 2 hours before the deadline. The form submits automatically 1 hour before unless you edit. If it is still open after the deadline, 1-Apply tries once more and notifies you.",
    });
  }

  // One-shot post-deadline attempt (cancelled if primary submit succeeds).
  if (!state.postDeadlineAttempted) {
    const postDueAt = computePostDeadlineHostSubmitDueAt(deadlineAt);
    await upsertHostJob({
      supabase: input.supabase,
      actor: input.actor,
      applicationId: input.applicationId,
      sourceUrl: ctx.sourceUrl,
      jobKind: "submit",
      dueAt: postDueAt,
      idempotencyKey: postDeadlineHostSubmitIdempotencyKey(input.applicationId, deadlineAt),
      nextAction: `If still open after the deadline (${postDueAt.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}), 1-Apply will try once more.`,
      eventTitle: `Post-deadline retry scheduled — ${(ctx.opportunity as { title?: string } | null)?.title ?? "Application"}`,
      eventBody:
        "If this form is not submitted by the deadline, 1-Apply will attempt one final host submit and email you the result.",
    });
  }

  return primary;
}

/** Queue submit immediately when there is no deadline and every form field is filled. */
export async function scheduleHostSubmitWhenFullyComplete(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
}): Promise<{ ok: true; jobId: string } | { ok: false; reason: string }> {
  const { assessNoDeadlineHostSubmitReadiness } = await import("./host-submit-readiness");
  const readiness = await assessNoDeadlineHostSubmitReadiness(input);
  if (!readiness.ready) return { ok: false, reason: readiness.reason ?? "not_ready" };

  const ctx = await loadApplicationContext(input.supabase, input.actor, input.applicationId);
  const blocked = hostContextUnavailableReason(ctx);
  if (blocked) return { ok: false, reason: blocked };
  if (!ctx?.sourceUrl) return { ok: false, reason: "not_found" };

  const noDeadlineState = await loadHostSubmitAttemptState(input.supabase, input.applicationId, {
    status: String(ctx.application.status),
    submitted_at: null,
  });
  if (!shouldCreateNewAutoSubmitJob(noDeadlineState)) {
    return {
      ok: false,
      reason: noDeadlineState.hostSubmitSucceeded ? "already_submitted" : "submit_already_attempted",
    };
  }

  return upsertHostJob({
    supabase: input.supabase,
    actor: input.actor,
    applicationId: input.applicationId,
    sourceUrl: ctx.sourceUrl,
    jobKind: "submit",
    dueAt: new Date(),
    idempotencyKey: `${input.applicationId}:host_submit:no_deadline_complete`,
    nextAction: "All form fields are filled — submitting to the host now.",
    eventTitle: `Auto-submit queued — ${(ctx.opportunity as { title?: string } | null)?.title ?? "Application"}`,
    eventBody: "Every required and optional field is complete. The server will fill and submit this form.",
  });
}

/** Resume headless fill after Need You: replay filled pages, then Next or Submit. */
export async function queueHostFillContinueJob(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  clickFinalSubmit: boolean;
}): Promise<{ ok: true; jobId: string } | { ok: false; reason: string }> {
  const ctx = await loadApplicationContext(input.supabase, input.actor, input.applicationId);
  const blocked = hostContextUnavailableReason(ctx);
  if (blocked) return { ok: false, reason: blocked };
  if (!ctx?.sourceUrl) return { ok: false, reason: "not_found" };

  const continueState = await loadHostSubmitAttemptState(input.supabase, input.applicationId, {
    status: String(ctx.application.status),
    submitted_at: null,
  });
  if (!shouldContinueHostFill(continueState)) {
    return { ok: false, reason: "submit_already_attempted" };
  }

  return upsertHostJob({
    supabase: input.supabase,
    actor: input.actor,
    applicationId: input.applicationId,
    sourceUrl: ctx.sourceUrl,
    jobKind: input.clickFinalSubmit ? "submit" : "prefill",
    dueAt: new Date(),
    idempotencyKey: `${input.applicationId}:host_page_loop`,
    reopenIfComplete: true,
    nextAction: input.clickFinalSubmit
      ? "Required fields are ready — filling the host form and continuing to Next or Submit."
      : "Required fields are ready — filling the host form from saved answers.",
    eventTitle: input.clickFinalSubmit ? "Host fill continuing" : "Host prefill continuing",
    eventBody:
      "1-Apply will open the form, fill this page from saved answers, then tap Next or Submit.",
  });
}

export async function queueHostSubmitJob(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  dueAt?: Date;
}): Promise<{ ok: true; jobId: string } | { ok: false; reason: string }> {
  if (input.dueAt) {
    const ctx = await loadApplicationContext(input.supabase, input.actor, input.applicationId);
    const blocked = hostContextUnavailableReason(ctx);
    if (blocked) return { ok: false, reason: blocked };
    if (!ctx?.sourceUrl) return { ok: false, reason: "not_found" };
    const state = await loadHostSubmitAttemptState(input.supabase, input.applicationId, {
      status: String(ctx.application.status),
      submitted_at: null,
    });
    if (!shouldCreateNewAutoSubmitJob(state)) {
      return { ok: false, reason: state.hostSubmitSucceeded ? "already_submitted" : "submit_already_attempted" };
    }
    return upsertHostJob({
      supabase: input.supabase,
      actor: input.actor,
      applicationId: input.applicationId,
      sourceUrl: ctx.sourceUrl,
      jobKind: "submit",
      dueAt: input.dueAt,
      idempotencyKey: `${input.applicationId}:host_submit:${input.dueAt.toISOString().slice(0, 16)}`,
      nextAction: "Queued for server auto-submit.",
      eventTitle: "Auto-submit queued",
      eventBody: "1-Apply will fill and submit this form on the server.",
    });
  }
  return scheduleHostSubmitJob(input);
}

/** User tapped Resubmit — one new submit job, independent of earlier auto-submit attempts. */
export async function queueManualHostSubmitJob(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
}): Promise<{ ok: true; jobId: string } | { ok: false; reason: string }> {
  const ctx = await loadApplicationContext(input.supabase, input.actor, input.applicationId);
  const blocked = hostContextUnavailableReason(ctx, { allowClosed: true });
  if (blocked) return { ok: false, reason: blocked };
  if (!ctx?.sourceUrl) return { ok: false, reason: "not_found" };

  const now = new Date();
  const queue = createServiceRoleSupabaseClient();
  if (ctx.closed) {
    await queue
      .from("applications")
      .update({
        status: "in_progress",
        submitted_at: null,
        next_action: "Resubmit queued — filling and submitting the host form now.",
      })
      .eq("id", input.applicationId)
      .eq("user_id", input.actor.userId);
  }
  await queue
    .from("host_submit_jobs")
    .update({
      status: "cancelled",
      completed_at: now.toISOString(),
      last_error: "cancelled_by_manual_resubmit",
    })
    .eq("application_id", input.applicationId)
    .eq("user_id", input.actor.userId)
    .eq("job_kind", "submit")
    .in("status", ["pending", "running"]);

  return upsertHostJob({
    supabase: input.supabase,
    actor: input.actor,
    applicationId: input.applicationId,
    sourceUrl: ctx.sourceUrl,
    jobKind: "submit",
    dueAt: now,
    idempotencyKey: `${input.applicationId}:host_submit:manual:${Date.now()}`,
    forceManual: true,
    nextAction: "Resubmit queued — filling and submitting the host form now.",
    eventTitle: `Resubmit queued — ${(ctx.opportunity as { title?: string } | null)?.title ?? "Application"}`,
    eventBody: "You asked 1-Apply to submit this form again. The server will fill and click Submit once.",
  });
}

export async function completeHostPrefillJob(input: {
  supabase: SupabaseClient;
  actor: Actor;
  jobId: string;
  filledFields: number;
  error?: string | null;
  blockedReason?: string | null;
  pausedForNeedsYou?: boolean;
  missingRequired?: string[];
}): Promise<{ ok: boolean }> {
  const { supabase, actor, jobId, filledFields, error, blockedReason, pausedForNeedsYou, missingRequired } = input;

  const { data: job } = await supabase
    .from("host_submit_jobs")
    .select("id, application_id")
    .eq("id", jobId)
    .eq("user_id", actor.userId)
    .maybeSingle();

  if (!job) return { ok: false };

  const applicationId = String(job.application_id);
  const now = new Date().toISOString();

  if (blockedReason) {
    await supabase
      .from("host_submit_jobs")
      .update({ status: "blocked", last_error: blockedReason.slice(0, 500), completed_at: now })
      .eq("id", jobId);
    return { ok: true };
  }

  if (error) {
    await supabase
      .from("host_submit_jobs")
      .update({ status: "failed", last_error: error.slice(0, 500), completed_at: now })
      .eq("id", jobId);
    return { ok: true };
  }

  const waitingLabels = (missingRequired ?? []).filter(Boolean).slice(0, 4).join(", ");
  await supabase
    .from("host_submit_jobs")
    .update({
      status: "completed",
      completed_at: now,
      last_error: pausedForNeedsYou ? "waiting_needs_you" : null,
    })
    .eq("id", jobId);

  await supabase
    .from("applications")
    .update({
      next_action: pausedForNeedsYou
        ? waitingLabels
          ? `Needs you — required fields on this page: ${waitingLabels}`
          : "Needs you — missing fields Application Memory cannot answer yet"
        : `Prefilled ${filledFields} field(s) from your profile. Review before auto-submit 1 hour before the deadline.`,
    })
    .eq("id", applicationId)
    .eq("user_id", actor.userId);

  if (pausedForNeedsYou) {
    await recordApplicationEvent(supabase, actor, applicationId, "application.host_prefilled", {
      jobId,
      filledFields,
      pausedForNeedsYou: true,
      missingRequired: missingRequired ?? [],
    });
    return { ok: true };
  }

  await recordApplicationEvent(supabase, actor, applicationId, "application.host_prefilled", {
    jobId,
    filledFields,
  });

  await emitDomainEvent(supabase, {
    name: "answer.generated",
    userId: actor.userId,
    applicationId,
    subjectId: `${applicationId}:host_prefill`,
    title: "Form prefilled from your profile",
    body: `The server filled ${filledFields} field(s). Open the application to review before auto-submit.`,
  });

  return { ok: true };
}

export async function completeHostSubmitJob(input: {
  supabase: SupabaseClient;
  actor: Actor;
  jobId: string;
  submitted: boolean;
  hostSubmitClicked: boolean;
  error?: string | null;
  blockedReason?: string | null;
  pausedForNeedsYou?: boolean;
  missingRequired?: string[];
}): Promise<{ ok: boolean }> {
  const { supabase, actor, jobId, submitted, hostSubmitClicked, blockedReason, pausedForNeedsYou, missingRequired } =
    input;
  let error = input.error ?? null;

  const { data: job } = await supabase
    .from("host_submit_jobs")
    .select("id, application_id, status, idempotency_key")
    .eq("id", jobId)
    .eq("user_id", actor.userId)
    .maybeSingle();

  if (!job) return { ok: false };
  if (String(job.status) === "cancelled") {
    // Replaced by Resubmit — do not clobber the new job or mark this click as terminal.
    return { ok: true };
  }

  const applicationId = String(job.application_id);
  const postDeadline = isPostDeadlineHostSubmitKey(String(job.idempotency_key ?? ""));
  const now = new Date().toISOString();

  async function cancelPendingSubmitSiblings(reason: string, includePostDeadline: boolean) {
    const { data: siblings } = await supabase
      .from("host_submit_jobs")
      .select("id, idempotency_key")
      .eq("application_id", applicationId)
      .eq("user_id", actor.userId)
      .eq("job_kind", "submit")
      .in("status", ["pending", "running"])
      .neq("id", jobId);
    const ids = (siblings ?? [])
      .filter((row) => includePostDeadline || !isPostDeadlineHostSubmitKey(String(row.idempotency_key ?? "")))
      .filter((row) => !isManualHostSubmitKey(String(row.idempotency_key ?? "")))
      .map((row) => String(row.id));
    if (ids.length === 0) return;
    await supabase
      .from("host_submit_jobs")
      .update({
        status: "cancelled",
        completed_at: now,
        last_error: reason,
      })
      .in("id", ids);
  }

  if (blockedReason) {
    await supabase
      .from("host_submit_jobs")
      .update({
        status: "blocked",
        last_error: blockedReason.slice(0, 500),
        completed_at: now,
      })
      .eq("id", jobId);

    await emitDomainEvent(supabase, {
      name: "automation.account_action",
      userId: actor.userId,
      applicationId,
      subjectId: `${applicationId}:host_submit_blocked${postDeadline ? ":post" : ""}`,
      title: postDeadline ? "Post-deadline submit blocked at host" : "Auto-submit blocked at host",
      body: postDeadline
        ? `After the deadline, submit was blocked: ${blockedReason}`
        : blockedReason,
      payload: { captcha: /captcha/i.test(blockedReason), postDeadline },
    });
    return { ok: true };
  }

  if (pausedForNeedsYou) {
    const waitingLabels = (missingRequired ?? []).filter(Boolean).slice(0, 4).join(", ");
    await supabase
      .from("host_submit_jobs")
      .update({
        status: "completed",
        completed_at: now,
        last_error: "waiting_needs_you",
      })
      .eq("id", jobId);
    await supabase
      .from("applications")
      .update({
        next_action: waitingLabels
          ? `Needs you — required fields on this page: ${waitingLabels}`
          : "Needs you — missing fields Application Memory cannot answer yet",
      })
      .eq("id", applicationId)
      .eq("user_id", actor.userId);
    await recordApplicationEvent(supabase, actor, applicationId, "application.host_prefilled", {
      jobId,
      pausedForNeedsYou: true,
      missingRequired: missingRequired ?? [],
    });
    return { ok: true };
  }

  if (hostSubmitClicked && submitted) {
    await supabase
      .from("host_submit_jobs")
      .update({
        status: "submitted",
        host_submit_clicked: true,
        completed_at: now,
        last_error: null,
      })
      .eq("id", jobId);

    await cancelPendingSubmitSiblings("cancelled_after_successful_submit", true);

    const freeze = await freezeApplicationPacket({
      supabase,
      actor,
      applicationId,
      source: "silence",
      hostSubmitClicked: true,
      emitNotification: false,
    });

    const nextAction = postDeadline
      ? "Submitted to the host after the deadline (final retry)."
      : "Submitted to the host before the deadline.";

    if (!freeze.ok) {
      await supabase
        .from("applications")
        .update({
          status: "submitted",
          submitted_at: now,
          next_action: nextAction,
        })
        .eq("id", applicationId)
        .eq("user_id", actor.userId)
        .neq("status", "submitted");
    } else if (postDeadline) {
      await supabase
        .from("applications")
        .update({ next_action: nextAction })
        .eq("id", applicationId)
        .eq("user_id", actor.userId);
    }

    await recordApplicationEvent(supabase, actor, applicationId, "application.host_submitted", {
      jobId,
      hostSubmitClicked: true,
      hostConfirmationDetected: true,
      postDeadline,
    });

    await emitDomainEvent(supabase, {
      name: "submission.completed",
      userId: actor.userId,
      applicationId,
      subjectId: `${applicationId}:host_submit${postDeadline ? ":post_deadline" : ""}`,
      title: postDeadline ? "Form submitted after the deadline" : "Form submitted to host",
      body: postDeadline
        ? "The form was still open after the deadline. 1-Apply submitted it on the final retry."
        : "1-Apply filled and clicked Submit on the host form. The host confirmed the response.",
      payload: { postDeadline, hostConfirmationDetected: true },
    });
    return { ok: true };
  }

  if (hostSubmitClicked && !submitted) {
    // Click without confirmation must not mark the application submitted.
    error = error ?? "Submit was clicked but the host did not confirm the response.";
  }

  await supabase
    .from("host_submit_jobs")
    .update({
      status: "failed",
      host_submit_clicked: hostSubmitClicked,
      last_error: (error ?? "submit_failed").slice(0, 500),
      completed_at: now,
    })
    .eq("id", jobId);

  if (hostSubmitClicked) {
    // Keep the post-deadline one-shot; cancel any other auto-submit retries.
    await cancelPendingSubmitSiblings("cancelled_after_submit_click", false);
  }

  await emitDomainEvent(supabase, {
    name: "submission.failed",
    userId: actor.userId,
    applicationId,
    subjectId: `${applicationId}:host_submit_failed${postDeadline ? ":post_deadline" : ""}`,
    title: postDeadline ? "Could not submit after the deadline" : "Auto-submit failed",
    body: postDeadline
      ? `Final post-deadline attempt failed: ${error ?? "Could not submit the host form."} Submit the form manually now.`
      : error ?? "Could not submit the host form. Open the form and submit manually.",
    payload: { postDeadline },
  });

  await supabase
    .from("applications")
    .update({
      next_action: postDeadline
        ? "Post-deadline submit failed — open the host form and submit manually."
        : (error ?? "Could not submit the host form. Open the form and submit manually, or tap Resubmit."),
    })
    .eq("id", applicationId)
    .eq("user_id", actor.userId);

  return { ok: true };
}
