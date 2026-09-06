import { isPostDeadlineHostSubmitKey } from "@1apply/domain";

import {
  completeHostPrefillJob,
  completeHostSubmitJob,
  loadHostSubmitAttemptState,
  recoverStaleRunningHostJobs,
} from "@/server/applications/host-submit";
import { isExtensionHostSubmitEnabled } from "@/server/applications/host-submit-flags";
import {
  isManualHostSubmitKey,
  shouldCancelAfterSiblingSubmitClick,
  shouldSkipClaimedSubmitJob,
} from "@/server/applications/host-submit-policy";
import { logError, logInfo } from "@/lib/log";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/admin";
import type { Actor } from "@/auth/actor";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const ExtensionHostSubmitJobSchema = z.object({
  jobId: z.string().uuid(),
  applicationId: z.string().uuid(),
  sourceUrl: z.string().url(),
  jobKind: z.enum(["prefill", "submit"]),
  clickFinalSubmit: z.boolean(),
  dueAt: z.string(),
  attemptCount: z.number().int().nonnegative(),
  idempotencyKey: z.string().optional(),
});

export type ExtensionHostSubmitJob = z.infer<typeof ExtensionHostSubmitJobSchema>;

export const ExtensionHostSubmitCompleteSchema = z.object({
  jobId: z.string().uuid(),
  filledFields: z.number().int().nonnegative().optional(),
  submitted: z.boolean().optional(),
  hostSubmitClicked: z.boolean().optional(),
  error: z.string().max(2000).nullable().optional(),
  blockedReason: z.string().max(2000).nullable().optional(),
  pausedForNeedsYou: z.boolean().optional(),
  missingRequired: z.array(z.string()).max(40).optional(),
});

export type ExtensionHostSubmitComplete = z.infer<typeof ExtensionHostSubmitCompleteSchema>;

const MAX_EXTENSION_JOBS = 3;
const MAX_ATTEMPTS = 5;
/** Scan more due rows than we return so skip/cancel still fills the batch. */
const CLAIM_SCAN_LIMIT = 20;

function clickFinalSubmitForJob(jobKind: string, idempotencyKey: string | null | undefined): boolean {
  if (jobKind === "prefill") return false;
  // Page-loop continue jobs may be submit-kind with clickFinalSubmit implied by schedule.
  // All submit-kind jobs from the queue are meant to click Submit when due.
  return jobKind === "submit";
}

async function cancelHostJob(
  queue: SupabaseClient,
  jobId: string,
  reason: string,
  statusFilter: "pending" | "running" = "pending",
): Promise<void> {
  await queue
    .from("host_submit_jobs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      last_error: reason,
    })
    .eq("id", jobId)
    .eq("status", statusFilter);
}

/**
 * Decide whether a submit job may run. Mirrors Playwright worker guards so we never
 * double-submit after application.status becomes submitted (or a sibling already clicked).
 */
async function evaluateExtensionSubmitJob(input: {
  queue: SupabaseClient;
  jobId: string;
  applicationId: string;
  idempotencyKey: string | null | undefined;
  phase: "claim" | "begin";
}): Promise<"run" | "skip"> {
  const { queue, jobId, applicationId, phase } = input;
  const jobStatus = phase === "begin" ? "running" : "pending";
  const postDeadline = isPostDeadlineHostSubmitKey(input.idempotencyKey);
  const manual = isManualHostSubmitKey(input.idempotencyKey);

  const { data: application } = await queue
    .from("applications")
    .select("status, submitted_at")
    .eq("id", applicationId)
    .maybeSingle();

  const state = await loadHostSubmitAttemptState(queue, applicationId, application ?? undefined);

  if (state.hostSubmitSucceeded || state.applicationSubmitted) {
    await cancelHostJob(queue, jobId, "cancelled_application_already_closed", jobStatus);
    return "skip";
  }

  if (shouldSkipClaimedSubmitJob({ state, postDeadline, manual })) {
    if (!postDeadline && !manual && (state.hostSubmitClicked || state.firstSubmitAttemptFinished)) {
      await cancelHostJob(queue, jobId, "cancelled_extra_auto_submit", jobStatus);
    } else if (phase === "begin") {
      // Do not leave a running job stuck when policy only defers (e.g. Needs You).
      await queue
        .from("host_submit_jobs")
        .update({ status: "pending", last_error: "deferred_by_policy" })
        .eq("id", jobId)
        .eq("status", "running");
    }
    return "skip";
  }

  const { data: siblings } = await queue
    .from("host_submit_jobs")
    .select("id, status, host_submit_clicked, due_at, idempotency_key")
    .eq("application_id", applicationId)
    .eq("job_kind", "submit");

  const siblingClickedSubmit = (siblings ?? []).some(
    (row) => String(row.id) !== jobId && row.host_submit_clicked,
  );
  if (shouldCancelAfterSiblingSubmitClick({ manual, siblingClickedSubmit })) {
    await cancelHostJob(queue, jobId, "cancelled_after_submit_click", jobStatus);
    return "skip";
  }

  // Claim-only: avoid racing two autos; begin trusts the already-running claim.
  if (phase === "claim") {
    if ((siblings ?? []).some((row) => String(row.id) !== jobId && String(row.status) === "running")) {
      return "skip";
    }

    if (!postDeadline && !manual) {
      const pendingAutos = (siblings ?? []).filter((row) => {
        if (String(row.status) !== "pending") return false;
        if (isPostDeadlineHostSubmitKey(row.idempotency_key)) return false;
        if (isManualHostSubmitKey(row.idempotency_key)) return false;
        return true;
      });
      if (pendingAutos.length > 1) {
        const chosen = pendingAutos
          .slice()
          .sort(
            (a, b) =>
              String(a.due_at ?? "").localeCompare(String(b.due_at ?? "")) ||
              String(a.id).localeCompare(String(b.id)),
          )[0];
        if (!chosen || String(chosen.id) !== jobId) return "skip";
      }
    }
  }

  return "run";
}

/**
 * Claim up to N due host_submit_jobs for this user and return them for the extension to execute.
 * Skips/cancels submit jobs when the application is already submitted or a sibling already clicked Submit.
 */
export async function claimPendingHostJobsForExtension(input: {
  supabase: SupabaseClient;
  actor: Actor;
}): Promise<ExtensionHostSubmitJob[]> {
  if (!isExtensionHostSubmitEnabled()) return [];

  const queue = createServiceRoleSupabaseClient();
  await recoverStaleRunningHostJobs(queue);

  const nowIso = new Date().toISOString();
  const { data: rows } = await queue
    .from("host_submit_jobs")
    .select("id, application_id, source_url, due_at, status, attempt_count, job_kind, idempotency_key")
    .eq("user_id", input.actor.userId)
    .eq("status", "pending")
    .lte("due_at", nowIso)
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("due_at", { ascending: true })
    .limit(CLAIM_SCAN_LIMIT);

  const claimed: ExtensionHostSubmitJob[] = [];
  const claimedSubmitApps = new Set<string>();

  for (const row of rows ?? []) {
    if (claimed.length >= MAX_EXTENSION_JOBS) break;

    const jobId = String(row.id);
    const applicationId = String(row.application_id);
    const jobKind = (row.job_kind as "prefill" | "submit") ?? "submit";
    const idempotencyKey = row.idempotency_key ? String(row.idempotency_key) : undefined;

    if (jobKind === "submit") {
      if (claimedSubmitApps.has(applicationId)) continue;
      const decision = await evaluateExtensionSubmitJob({
        queue,
        jobId,
        applicationId,
        idempotencyKey,
        phase: "claim",
      });
      if (decision === "skip") continue;
    }

    const { data: updated } = await queue
      .from("host_submit_jobs")
      .update({
        status: "running",
        attempt_count: Number(row.attempt_count ?? 0) + 1,
        last_error: "claimed_by_extension",
      })
      .eq("id", jobId)
      .eq("user_id", input.actor.userId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (!updated) continue;

    if (jobKind === "submit") claimedSubmitApps.add(applicationId);

    claimed.push(
      ExtensionHostSubmitJobSchema.parse({
        jobId,
        applicationId,
        sourceUrl: String(row.source_url),
        jobKind,
        clickFinalSubmit: clickFinalSubmitForJob(jobKind, idempotencyKey),
        dueAt: String(row.due_at),
        attemptCount: Number(row.attempt_count ?? 0) + 1,
        idempotencyKey,
      }),
    );
  }

  if (claimed.length) {
    logInfo("host_submit.extension_claimed", {
      userId: input.actor.userId,
      count: claimed.length,
      jobIds: claimed.map((job) => job.jobId),
    });
  }

  return claimed;
}

export const ExtensionHostSubmitBeginSchema = z.object({
  jobId: z.string().uuid(),
});

/**
 * Re-check a claimed job right before the extension opens the form / clicks Submit.
 * Cancels and returns ok:false when the application is already submitted or the job was replaced.
 */
export async function beginHostJobFromExtension(input: {
  actor: Actor;
  jobId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!isExtensionHostSubmitEnabled()) {
    return { ok: false, reason: "extension_disabled" };
  }

  const queue = createServiceRoleSupabaseClient();
  const { data: job } = await queue
    .from("host_submit_jobs")
    .select("id, job_kind, status, application_id, idempotency_key")
    .eq("id", input.jobId)
    .eq("user_id", input.actor.userId)
    .maybeSingle();

  if (!job) return { ok: false, reason: "not_found" };
  if (String(job.status) === "cancelled") return { ok: false, reason: "cancelled" };
  if (String(job.status) !== "running") return { ok: false, reason: "not_running" };

  const jobKind = (job.job_kind as "prefill" | "submit") ?? "submit";
  if (jobKind !== "submit") return { ok: true };

  const decision = await evaluateExtensionSubmitJob({
    queue,
    jobId: String(job.id),
    applicationId: String(job.application_id),
    idempotencyKey: job.idempotency_key ? String(job.idempotency_key) : undefined,
    phase: "begin",
  });

  if (decision === "skip") {
    logInfo("host_submit.extension_begin_skipped", {
      userId: input.actor.userId,
      jobId: input.jobId,
      applicationId: String(job.application_id),
    });
    return { ok: false, reason: "already_submitted_or_superseded" };
  }

  return { ok: true };
}

/**
 * Complete a job the extension finished (or failed). Reuses the same status machine as Playwright.
 */
export async function completeHostJobFromExtension(input: {
  supabase: SupabaseClient;
  actor: Actor;
  body: ExtensionHostSubmitComplete;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!isExtensionHostSubmitEnabled()) {
    return { ok: false, reason: "extension_disabled" };
  }

  const parsed = ExtensionHostSubmitCompleteSchema.safeParse(input.body);
  if (!parsed.success) return { ok: false, reason: "invalid_body" };

  const queue = createServiceRoleSupabaseClient();
  const { data: job } = await queue
    .from("host_submit_jobs")
    .select("id, job_kind, status, application_id, idempotency_key, attempt_count")
    .eq("id", parsed.data.jobId)
    .eq("user_id", input.actor.userId)
    .maybeSingle();

  if (!job) return { ok: false, reason: "not_found" };
  if (String(job.status) === "cancelled") return { ok: true, reason: "cancelled" };

  const jobKind = (job.job_kind as "prefill" | "submit") ?? "submit";
  const oneShot =
    isPostDeadlineHostSubmitKey(String(job.idempotency_key ?? "")) ||
    isManualHostSubmitKey(String(job.idempotency_key ?? ""));

  try {
    if (jobKind === "prefill") {
      if (parsed.data.blockedReason) {
        await completeHostPrefillJob({
          supabase: input.supabase,
          actor: input.actor,
          jobId: parsed.data.jobId,
          filledFields: parsed.data.filledFields ?? 0,
          error: parsed.data.blockedReason,
          blockedReason: parsed.data.blockedReason,
        });
        return { ok: true };
      }
      if (parsed.data.pausedForNeedsYou) {
        await completeHostPrefillJob({
          supabase: input.supabase,
          actor: input.actor,
          jobId: parsed.data.jobId,
          filledFields: parsed.data.filledFields ?? 0,
          pausedForNeedsYou: true,
          missingRequired: parsed.data.missingRequired,
        });
        return { ok: true };
      }
      if (parsed.data.error) {
        const attempts = Number(job.attempt_count ?? 1);
        if (oneShot || attempts >= MAX_ATTEMPTS) {
          await completeHostPrefillJob({
            supabase: input.supabase,
            actor: input.actor,
            jobId: parsed.data.jobId,
            filledFields: parsed.data.filledFields ?? 0,
            error: parsed.data.error,
          });
        } else {
          await queue
            .from("host_submit_jobs")
            .update({ status: "pending", last_error: parsed.data.error.slice(0, 500) })
            .eq("id", parsed.data.jobId);
        }
        return { ok: true };
      }
      await completeHostPrefillJob({
        supabase: input.supabase,
        actor: input.actor,
        jobId: parsed.data.jobId,
        filledFields: parsed.data.filledFields ?? 0,
      });
      return { ok: true };
    }

    // submit kind
    if (parsed.data.blockedReason) {
      await completeHostSubmitJob({
        supabase: input.supabase,
        actor: input.actor,
        jobId: parsed.data.jobId,
        submitted: false,
        hostSubmitClicked: Boolean(parsed.data.hostSubmitClicked),
        blockedReason: parsed.data.blockedReason,
      });
      return { ok: true };
    }
    if (parsed.data.pausedForNeedsYou) {
      await completeHostSubmitJob({
        supabase: input.supabase,
        actor: input.actor,
        jobId: parsed.data.jobId,
        submitted: false,
        hostSubmitClicked: false,
        pausedForNeedsYou: true,
        missingRequired: parsed.data.missingRequired,
      });
      return { ok: true };
    }

    const submitted = Boolean(parsed.data.submitted);
    const hostSubmitClicked = Boolean(parsed.data.hostSubmitClicked);
    if (submitted || hostSubmitClicked || parsed.data.error) {
      await completeHostSubmitJob({
        supabase: input.supabase,
        actor: input.actor,
        jobId: parsed.data.jobId,
        submitted,
        hostSubmitClicked,
        error: parsed.data.error ?? (submitted ? null : "Extension could not confirm host submission."),
      });
      return { ok: true };
    }

    // Soft failure — requeue unless one-shot
    const attempts = Number(job.attempt_count ?? 1);
    if (oneShot || attempts >= MAX_ATTEMPTS) {
      await completeHostSubmitJob({
        supabase: input.supabase,
        actor: input.actor,
        jobId: parsed.data.jobId,
        submitted: false,
        hostSubmitClicked: false,
        error: "Extension reported no result.",
      });
    } else {
      await queue
        .from("host_submit_jobs")
        .update({ status: "pending", last_error: "extension_retry" })
        .eq("id", parsed.data.jobId);
    }
    return { ok: true };
  } catch (err) {
    logError("host_submit.extension_complete_failed", {
      err,
      jobId: parsed.data.jobId,
      userId: input.actor.userId,
    });
    return { ok: false, reason: "complete_failed" };
  }
}
