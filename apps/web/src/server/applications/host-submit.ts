import { computeHostSubmitDueAt } from "@1apply/domain";
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
  } = input;

  const queue = createServiceRoleSupabaseClient();

  const { data: existing } = await queue
    .from("host_submit_jobs")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) {
    const terminal = ["submitted", "completed", "blocked", "cancelled"];
    if (terminal.includes(String(existing.status))) {
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
 */
export async function reconcileOverdueHostSubmitJobs(supabase: SupabaseClient): Promise<number> {
  const { loadActorForUser } = await import("./host-submit-worker");
  const now = new Date();
  const { data: applications, error } = await supabase
    .from("applications")
    .select("id, user_id, status, deadline_at, opportunities ( canonical_url, source_url )")
    .not("deadline_at", "is", null)
    .in("status", ["saved", "analyzing", "ready_to_apply", "in_progress", "review_required", "draft", "preparing", "ready"])
    .lte("deadline_at", new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString())
    .limit(80);

  if (error) {
    logError("host_submit.reconcile_load_failed", { error });
    return 0;
  }

  let requeued = 0;
  for (const application of applications ?? []) {
    const deadlineAt = String(application.deadline_at);
    const dueAt = computeHostSubmitDueAt(deadlineAt, now);
    if (dueAt.getTime() > now.getTime()) continue;

    const opportunity = Array.isArray(application.opportunities)
      ? application.opportunities[0]
      : application.opportunities;
    const sourceUrl =
      publicFormUrl((opportunity as { canonical_url?: string | null } | null)?.canonical_url) ??
      publicFormUrl((opportunity as { source_url?: string | null } | null)?.source_url);
    if (!sourceUrl) continue;

    const idempotencyKey = `${application.id}:host_submit:${deadlineAt}`;
    const { data: job } = await supabase
      .from("host_submit_jobs")
      .select("id, status, attempt_count, job_kind")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (job?.status === "submitted") continue;
    if (job?.status === "pending" || job?.status === "running") continue;
    if (job?.status === "blocked" || job?.status === "cancelled") continue;

    const actor = await loadActorForUser(supabase, String(application.user_id));
    if (!actor) continue;

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

  return upsertHostJob({
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
      "You'll get a review email up to 2 hours before the deadline. The form submits automatically 1 hour before unless you edit.",
  });
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

export async function listPendingHostSubmitJobs(
  supabase: SupabaseClient,
  userId: string,
): Promise<HostSubmitJobRow[]> {
  const { data } = await supabase
    .from("host_submit_jobs")
    .select("id, application_id, source_url, due_at, status, attempt_count, job_kind")
    .eq("user_id", userId)
    .eq("job_kind", "submit")
    .in("status", ["pending", "running"])
    .lte("due_at", new Date(Date.now() + 5 * 60 * 1000).toISOString())
    .order("due_at", { ascending: true })
    .limit(10);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    application_id: String(row.application_id),
    source_url: String(row.source_url),
    due_at: String(row.due_at),
    status: String(row.status),
    attempt_count: Number(row.attempt_count ?? 0),
    job_kind: (row.job_kind as HostSubmitJobKind) ?? "submit",
  }));
}

export async function markHostSubmitJobRunning(
  supabase: SupabaseClient,
  userId: string,
  jobId: string,
): Promise<boolean> {
  const { data: existing } = await supabase
    .from("host_submit_jobs")
    .select("id, attempt_count, status")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!existing || !["pending", "running"].includes(String(existing.status))) return false;

  const { data } = await supabase
    .from("host_submit_jobs")
    .update({
      status: "running",
      attempt_count: Number(existing.attempt_count ?? 0) + 1,
    })
    .eq("id", jobId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  return Boolean(data);
}

export async function completeHostPrefillJob(input: {
  supabase: SupabaseClient;
  actor: Actor;
  jobId: string;
  filledFields: number;
  error?: string | null;
  blockedReason?: string | null;
}): Promise<{ ok: boolean }> {
  const { supabase, actor, jobId, filledFields, error, blockedReason } = input;

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

  await supabase
    .from("host_submit_jobs")
    .update({ status: "completed", completed_at: now, last_error: null })
    .eq("id", jobId);

  await supabase
    .from("applications")
    .update({
      next_action: `Prefilled ${filledFields} field(s) from your profile. Review before auto-submit 1 hour before the deadline.`,
    })
    .eq("id", applicationId)
    .eq("user_id", actor.userId);

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
}): Promise<{ ok: boolean }> {
  const { supabase, actor, jobId, submitted, hostSubmitClicked, error, blockedReason } = input;

  const { data: job } = await supabase
    .from("host_submit_jobs")
    .select("id, application_id, status")
    .eq("id", jobId)
    .eq("user_id", actor.userId)
    .maybeSingle();

  if (!job) return { ok: false };

  const applicationId = String(job.application_id);
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
      subjectId: `${applicationId}:host_submit_blocked`,
      title: "Auto-submit blocked at host",
      body: blockedReason,
      payload: { captcha: /captcha/i.test(blockedReason) },
    });
    return { ok: true };
  }

  if (hostSubmitClicked) {
    await supabase
      .from("host_submit_jobs")
      .update({
        status: "submitted",
        host_submit_clicked: true,
        completed_at: now,
        last_error: submitted ? null : "Submit clicked; host confirmation not detected.",
      })
      .eq("id", jobId);

    const freeze = await freezeApplicationPacket({
      supabase,
      actor,
      applicationId,
      source: "silence",
      hostSubmitClicked: true,
    });

    // Always mark the application submitted once the host Submit control was clicked,
    // even if snapshot freeze is a no-op (already frozen / race).
    if (!freeze.ok) {
      await supabase
        .from("applications")
        .update({
          status: "submitted",
          submitted_at: now,
          next_action: "Submitted to the host before the deadline.",
        })
        .eq("id", applicationId)
        .eq("user_id", actor.userId)
        .neq("status", "submitted");
    }

    await recordApplicationEvent(supabase, actor, applicationId, "application.host_submitted", {
      jobId,
      hostSubmitClicked: true,
      hostConfirmationDetected: submitted,
    });

    await emitDomainEvent(supabase, {
      name: "submission.completed",
      userId: actor.userId,
      applicationId,
      subjectId: `${applicationId}:host_submit`,
      title: "Form submitted to host",
      body: submitted
        ? "1-Apply filled and clicked Submit on the host form before the deadline."
        : "1-Apply clicked Submit on the host form. Open the form to confirm if needed.",
    });
    return { ok: true };
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
    subjectId: `${applicationId}:host_submit_failed`,
    title: "Auto-submit failed",
    body: error ?? "Could not submit the host form. Open the form and submit manually.",
  });

  return { ok: true };
}
