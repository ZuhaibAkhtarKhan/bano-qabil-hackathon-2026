import { onboardingStepSchema } from "@1apply/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import type { ProfileRow } from "@/lib/profile";
import { logError } from "@/lib/log";

import {
  completeHostPrefillJob,
  completeHostSubmitJob,
  type HostSubmitJobKind,
  type HostSubmitJobRow,
} from "./host-submit";
import {
  isServerHostSubmitEnabled,
  runPlaywrightHostPrefill,
  runPlaywrightHostSubmit,
} from "./playwright-host-submit";

const MAX_ATTEMPTS = 5;
const MAX_JOBS_PER_RUN = 3;

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
  const { data } = await supabase
    .from("host_submit_jobs")
    .select("id, user_id, application_id, source_url, due_at, status, attempt_count, job_kind")
    .eq("status", "pending")
    .lte("due_at", new Date().toISOString())
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("due_at", { ascending: true })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    user_id: String(row.user_id),
    application_id: String(row.application_id),
    source_url: String(row.source_url),
    due_at: String(row.due_at),
    status: String(row.status),
    attempt_count: Number(row.attempt_count ?? 0),
    job_kind: (row.job_kind as HostSubmitJobKind) ?? "submit",
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
}) {
  if (input.job.attempt_count + 1 >= MAX_ATTEMPTS) {
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
  let processed = 0;
  let prefilled = 0;
  let submitted = 0;
  let failed = 0;
  let blocked = 0;

  for (const job of jobs) {
    const claimed = await claimHostJob(supabase, job.id);
    if (!claimed) continue;

    processed += 1;
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

      if (result.ok && result.hostSubmitClicked && result.submitted) {
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
        ? "Submit clicked but confirmation not detected."
        : (result.error ?? "submit_failed");

      await requeueOrFail({
        supabase,
        actor,
        job,
        jobId: job.id,
        error: errorMessage,
        onFinalFail: async () => {
          await completeHostSubmitJob({
            supabase,
            actor,
            jobId: job.id,
            submitted: false,
            hostSubmitClicked: result.ok ? result.hostSubmitClicked : false,
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
