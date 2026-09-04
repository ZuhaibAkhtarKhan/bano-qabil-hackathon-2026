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
  if (["submitted", "rejected", "withdrawn", "archived", "offer"].includes(String(application.status))) {
    return null;
  }

  const opportunity = Array.isArray(application.opportunities)
    ? application.opportunities[0]
    : application.opportunities;
  const sourceUrl =
    publicFormUrl((opportunity as { canonical_url?: string | null } | null)?.canonical_url) ??
    publicFormUrl((opportunity as { source_url?: string | null } | null)?.source_url);

  return { application, opportunity, sourceUrl };
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
  /** Re-open a completed/failed job so page-loop can resume after Need You. */
  reopenIfComplete?: boolean;
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
  } = input;

  const queue = createServiceRoleSupabaseClient();

  const { data: existing } = await queue
    .from("host_submit_jobs")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) {
    const terminal = ["submitted", "blocked", "cancelled"];
    if (!reopenIfComplete) terminal.push("completed");
    if (terminal.includes(String(existing.status))) {
      return { ok: true, jobId: String(existing.id) };
    }
    // Post-deadline is a single attempt — never reopen after failure.
    if (String(existing.status) === "failed" && isPostDeadlineHostSubmitKey(idempotencyKey) && !reopenIfComplete) {
      return { ok: true, jobId: String(existing.id) };
    }
    const { error: updateError } = await queue
      .from("host_submit_jobs")
      .update({
        due_at: dueAt.toISOString(),
        source_url: sourceUrl,
        status: "pending",
        job_kind: jobKind,
        attempt_count: 0,
        last_error: null,
        completed_at: null,
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

    if (pastDeadline) {
      const postKey = postDeadlineHostSubmitIdempotencyKey(String(application.id), deadlineAt);
      const { data: postJob } = await supabase
        .from("host_submit_jobs")
        .select("id, status")
        .eq("idempotency_key", postKey)
        .maybeSingle();

      // One attempt after the deadline — do not reopen terminal outcomes.
      if (postJob && ["submitted", "failed", "blocked", "cancelled"].includes(String(postJob.status))) {
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

    const idempotencyKey = `${application.id}:host_submit:${deadlineAt}`;
    const { data: job } = await supabase
      .from("host_submit_jobs")
      .select("id, status, attempt_count, job_kind")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (job?.status === "submitted") continue;
    if (job?.status === "pending" || job?.status === "running") continue;
    if (job?.status === "blocked" || job?.status === "cancelled") continue;

    const result = await upsertHostJob({
      supabase,
      actor,
      applicationId: String(application.id),
      sourceUrl,
      jobKind: "submit",
      dueAt: now,
      idempotencyKey,
      nextAction: "Auto-submit re-queued — retrying host form submission.",
      eventTitle: "Auto-submit re-queued",
      eventBody: "The server will fill and submit this form again before the deadline passes.",
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
  if (!ctx?.sourceUrl) return { ok: false, reason: ctx ? "no_source_url" : "not_found" };

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
  if (!ctx?.sourceUrl) return { ok: false, reason: ctx ? "no_source_url" : "not_found" };

  const deadlineAt = (ctx.application.deadline_at as string | null) ?? null;
  if (!deadlineAt) return { ok: false, reason: "no_deadline" };

  const dueAt = computeHostSubmitDueAt(deadlineAt);
  const idempotencyKey = `${input.applicationId}:host_submit:${deadlineAt}`;

  const primary = await upsertHostJob({
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

  // Always schedule a one-shot post-deadline attempt (cancelled if primary submit succeeds).
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
  if (!ctx?.sourceUrl) return { ok: false, reason: ctx ? "no_source_url" : "not_found" };

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
  if (!ctx?.sourceUrl) return { ok: false, reason: ctx ? "no_source_url" : "not_found" };

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
    if (!ctx?.sourceUrl) return { ok: false, reason: ctx ? "no_source_url" : "not_found" };
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

  const applicationId = String(job.application_id);
  const postDeadline = isPostDeadlineHostSubmitKey(String(job.idempotency_key ?? ""));
  const now = new Date().toISOString();

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

    // Cancel any other pending/running submit jobs for this application (including post-deadline).
    await supabase
      .from("host_submit_jobs")
      .update({
        status: "cancelled",
        completed_at: now,
        last_error: "cancelled_after_successful_submit",
      })
      .eq("application_id", applicationId)
      .eq("user_id", actor.userId)
      .eq("job_kind", "submit")
      .in("status", ["pending", "running"])
      .neq("id", jobId);

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

  if (postDeadline) {
    await supabase
      .from("applications")
      .update({
        next_action: "Post-deadline submit failed — open the host form and submit manually.",
      })
      .eq("id", applicationId)
      .eq("user_id", actor.userId);
  }

  return { ok: true };
}
