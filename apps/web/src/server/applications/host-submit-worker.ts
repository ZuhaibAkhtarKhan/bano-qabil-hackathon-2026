import { onboardingStepSchema } from "@1apply/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import type { ProfileRow } from "@/lib/profile";
import { logError, logInfo } from "@/lib/log";
import { isPostDeadlineHostSubmitKey } from "@1apply/domain";

import {
  completeHostPrefillJob,
  completeHostSubmitJob,
  loadHostSubmitAttemptState,
  recoverStaleRunningHostJobs,
  type HostSubmitJobKind,
  type HostSubmitJobRow,
} from "./host-submit";
import {
  isManualHostSubmitKey,
  claimedSubmitSkipReason,
  shouldCancelAfterSiblingSubmitClick,
} from "./host-submit-policy";
import {
  isServerHostSubmitEnabled,
  runPlaywrightHostPrefill,
  runPlaywrightHostSubmit,
} from "./playwright-host-submit";

const MAX_ATTEMPTS = 5;
const MAX_JOBS_PER_RUN = 6;
const SUBMIT_JOB_RESERVE = 4;

function mapProfile(row: Record<string, unknown>): ProfileRow {
  const step = onboardingStepSchema.safeParse(row.onboarding_step);
  return {
    id: String(row.id),
    email: String(row.email ?? ""),
    display_name: (row.display_name as string | null) ?? null,
    headline: (row.headline as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    terms_accepted_at: (row.terms_accepted_at as string | null) ?? null,
    ai_processing_accepted_at: (row.ai_processing_accepted_at as string | null) ?? null,
    onboarding_completed_at: (row.onboarding_completed_at as string | null) ?? null,
    onboarding_step: step.success ? step.data : "consent",
    preferences: (row.preferences as Record<string, unknown> | null) ?? {},
    timezone: (row.timezone as string | null) ?? null,
  };
}

export async function loadActorForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<Actor | null> {
  const { data: profileRow } = await supabase
    .from("profiles")
    .select(
      "id, email, display_name, headline, phone, terms_accepted_at, ai_processing_accepted_at, onboarding_completed_at, onboarding_step, preferences, timezone",
    )
    .eq("id", userId)
    .maybeSingle();

  if (!profileRow?.email) return null;
  const profile = mapProfile(profileRow as Record<string, unknown>);
  return { userId, email: profile.email, profile };
}

export async function listClaimableHostJobs(
  supabase: SupabaseClient,
  limit = MAX_JOBS_PER_RUN,
): Promise<Array<HostSubmitJobRow & { user_id: string }>> {
  await recoverStaleRunningHostJobs(supabase);

  const nowIso = new Date().toISOString();
  const baseQuery = () =>
    supabase
      .from("host_submit_jobs")
      .select("id, user_id, application_id, source_url, due_at, status, attempt_count, job_kind, idempotency_key")
      .eq("status", "pending")
      .lte("due_at", nowIso)
      .lt("attempt_count", MAX_ATTEMPTS);

  const { data: prefillRows } = await baseQuery()
    .eq("job_kind", "prefill")
    .order("due_at", { ascending: true })
    .limit(limit);

  const remaining = limit - (prefillRows?.length ?? 0);
  const submitLimit = Math.min(SUBMIT_JOB_RESERVE, remaining);
  const { data: submitRows } =
    submitLimit > 0
      ? await baseQuery()
          .eq("job_kind", "submit")
          .order("due_at", { ascending: true })
          .limit(submitLimit)
      : { data: [] };

  return [...(prefillRows ?? []), ...(submitRows ?? [])].map((row) => ({
    id: String(row.id),
    user_id: String(row.user_id),
    application_id: String(row.application_id),
    source_url: String(row.source_url),
    due_at: String(row.due_at),
    status: String(row.status),
    attempt_count: Number(row.attempt_count ?? 0),
    job_kind: (row.job_kind as HostSubmitJobKind) ?? "submit",
    idempotency_key: row.idempotency_key ? String(row.idempotency_key) : undefined,
  }));
}

export async function claimHostJob(supabase: SupabaseClient, jobId: string): Promise<boolean> {
  const { data: existing } = await supabase
    .from("host_submit_jobs")
    .select("id, attempt_count, status")
    .eq("id", jobId)
    .maybeSingle();

  if (!existing || String(existing.status) !== "pending") return false;

  const { data } = await supabase
    .from("host_submit_jobs")
    .update({
      status: "running",
      attempt_count: Number(existing.attempt_count ?? 0) + 1,
    })
    .eq("id", jobId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  return Boolean(data);
}

async function requeueOrFail(input: {
  supabase: SupabaseClient;
  actor: Actor;
  job: HostSubmitJobRow & { user_id: string };
  jobId: string;
  error: string;
  onFinalFail: () => Promise<void>;
  /** Post-deadline jobs get exactly one attempt — never requeue. */
  oneShot?: boolean;
}) {
  if (input.oneShot) {
    await input.onFinalFail();
    return;
  }

  const { data: current } = await input.supabase
    .from("host_submit_jobs")
    .select("attempt_count")
    .eq("id", input.jobId)
    .maybeSingle();

  const attempts = Number(current?.attempt_count ?? input.job.attempt_count + 1);
  if (attempts >= MAX_ATTEMPTS) {
    await input.onFinalFail();
    return;
  }
  await input.supabase
    .from("host_submit_jobs")
    .update({ status: "pending", last_error: input.error.slice(0, 500) })
    .eq("id", input.jobId);
}

export async function runServerHostSubmitWorker(supabase: SupabaseClient): Promise<{
  processed: number;
  prefilled: number;
  submitted: number;
  failed: number;
  blocked: number;
  skipped: boolean;
}> {
  if (!isServerHostSubmitEnabled()) {
    return { processed: 0, prefilled: 0, submitted: 0, failed: 0, blocked: 0, skipped: true };
  }

  const jobs = await listClaimableHostJobs(supabase);
  if (jobs.length > 0) {
    logInfo("host_submit.worker_claiming", {
      count: jobs.length,
      kinds: jobs.map((job) => job.job_kind),
    });
  }
  let processed = 0;
  let prefilled = 0;
  let submitted = 0;
  let failed = 0;
  let blocked = 0;

  for (const job of jobs) {
    const postDeadline = isPostDeadlineHostSubmitKey(job.idempotency_key);
    const manual = isManualHostSubmitKey(job.idempotency_key);

    if (job.job_kind === "submit") {
      const { data: application } = await supabase
        .from("applications")
        .select("status, submitted_at")
        .eq("id", job.application_id)
        .maybeSingle();
      const state = await loadHostSubmitAttemptState(supabase, job.application_id, application ?? undefined);
      if (!manual && (state.hostSubmitSucceeded || state.applicationSubmitted)) {
        await supabase
          .from("host_submit_jobs")
          .update({
            status: "cancelled",
            completed_at: new Date().toISOString(),
            last_error: "cancelled_application_already_closed",
          })
          .eq("id", job.id);
        continue;
      }
      const skipReason = claimedSubmitSkipReason({ state, postDeadline, manual });
      if (skipReason) {
        logInfo("host_submit.worker_skipped", {
          jobId: job.id,
          applicationId: job.application_id,
          reason: skipReason,
        });
        if (
          !postDeadline &&
          !manual &&
          (state.hostSubmitClicked || state.firstSubmitAttemptFinished)
        ) {
          await supabase
            .from("host_submit_jobs")
            .update({
              status: "cancelled",
              completed_at: new Date().toISOString(),
              last_error: "cancelled_extra_auto_submit",
            })
            .eq("id", job.id)
            .eq("status", "pending");
        }
        continue;
      }

      const { data: siblings } = await supabase
        .from("host_submit_jobs")
        .select("id, status, host_submit_clicked, due_at, idempotency_key")
        .eq("application_id", job.application_id)
        .eq("job_kind", "submit");
      const siblingClickedSubmit = (siblings ?? []).some(
        (row) => String(row.id) !== job.id && row.host_submit_clicked,
      );
      if (shouldCancelAfterSiblingSubmitClick({ manual, siblingClickedSubmit })) {
        await supabase
          .from("host_submit_jobs")
          .update({
            status: "cancelled",
            completed_at: new Date().toISOString(),
            last_error: "cancelled_after_submit_click",
          })
          .eq("id", job.id)
          .eq("status", "pending");
        continue;
      }
      if ((siblings ?? []).some((row) => String(row.id) !== job.id && String(row.status) === "running")) {
        continue;
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
          if (!chosen || String(chosen.id) !== job.id) continue;
        }
      }
    }

    const claimed = await claimHostJob(supabase, job.id);
    if (!claimed) continue;

    processed += 1;
    logInfo("host_submit.worker_running", {
      jobId: job.id,
      jobKind: job.job_kind,
      applicationId: job.application_id,
      attempt: job.attempt_count + 1,
    });
    const actor = await loadActorForUser(supabase, job.user_id);
    if (!actor) {
      failed += 1;
      continue;
    }

    try {
      if (job.job_kind === "prefill") {
        const result = await runPlaywrightHostPrefill({
          supabase,
          actor,
          applicationId: job.application_id,
          sourceUrl: job.source_url,
        });

        if (!result.ok && result.blockedReason) {
          await completeHostPrefillJob({
            supabase,
            actor,
            jobId: job.id,
            filledFields: 0,
            blockedReason: result.blockedReason,
          });
          blocked += 1;
          continue;
        }

        if (result.ok && "pausedForNeedsYou" in result && result.pausedForNeedsYou) {
          await completeHostPrefillJob({
            supabase,
            actor,
            jobId: job.id,
            filledFields: result.filledFields,
            pausedForNeedsYou: true,
            missingRequired: result.missingRequired,
          });
          blocked += 1;
          continue;
        }

        if (result.ok) {
          await completeHostPrefillJob({
            supabase,
            actor,
            jobId: job.id,
            filledFields: result.filledFields,
            error: null,
          });
          prefilled += 1;
          continue;
        }

        const prefillError = result.error ?? "prefill_failed";
        await requeueOrFail({
          supabase,
          actor,
          job,
          jobId: job.id,
          error: prefillError,
          onFinalFail: async () => {
            await completeHostPrefillJob({
              supabase,
              actor,
              jobId: job.id,
              filledFields: 0,
              error: prefillError,
            });
          },
        });
        failed += 1;
        continue;
      }

      const result = await runPlaywrightHostSubmit({
        supabase,
        actor,
        applicationId: job.application_id,
        sourceUrl: job.source_url,
        clickFinalSubmit: true,
      });

      if (result.ok && "pausedForNeedsYou" in result && result.pausedForNeedsYou) {
        await completeHostSubmitJob({
          supabase,
          actor,
          jobId: job.id,
          submitted: false,
          hostSubmitClicked: false,
          pausedForNeedsYou: true,
          missingRequired: result.missingRequired,
        });
        blocked += 1;
        continue;
      }

      if (result.ok && result.submitted && result.hostSubmitClicked) {
        await completeHostSubmitJob({
          supabase,
          actor,
          jobId: job.id,
          submitted: true,
          hostSubmitClicked: true,
        });
        submitted += 1;
        continue;
      }

      if (!result.ok && result.blockedReason) {
        await completeHostSubmitJob({
          supabase,
          actor,
          jobId: job.id,
          submitted: false,
          hostSubmitClicked: false,
          blockedReason: result.blockedReason,
        });
        blocked += 1;
        continue;
      }

      const errorMessage = result.ok
        ? "Submit clicked but host confirmation was not detected — response may not have been recorded."
        : (result.error ?? "submit_failed");
      const hostSubmitClicked = Boolean(result.hostSubmitClicked);

      await requeueOrFail({
        supabase,
        actor,
        job,
        jobId: job.id,
        error: errorMessage,
        oneShot: postDeadline || manual || hostSubmitClicked,
        onFinalFail: async () => {
          await completeHostSubmitJob({
            supabase,
            actor,
            jobId: job.id,
            submitted: false,
            hostSubmitClicked,
            error: errorMessage,
          });
        },
      });
      failed += 1;
    } catch (err) {
      logError("host_submit.worker_job_failed", { err, jobId: job.id });
      const message = err instanceof Error ? err.message : "worker_failed";
      await requeueOrFail({
        supabase,
        actor,
        job,
        jobId: job.id,
        error: message,
        oneShot: postDeadline || manual,
        onFinalFail: async () => {
          if (job.job_kind === "prefill") {
            await completeHostPrefillJob({
              supabase,
              actor,
              jobId: job.id,
              filledFields: 0,
              error: message,
            });
          } else {
            await completeHostSubmitJob({
              supabase,
              actor,
              jobId: job.id,
              submitted: false,
              hostSubmitClicked: false,
              error: message,
            });
          }
        },
      });
      failed += 1;
    }
  }

  return { processed, prefilled, submitted, failed, blocked, skipped: false };
}
