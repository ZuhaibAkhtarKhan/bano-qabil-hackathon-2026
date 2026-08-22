import type { JobType } from "@1apply/contracts";
import { isRetryableJobError } from "@1apply/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { JOB_MAX_ATTEMPTS } from "@/config/env";
import { logError, logInfo } from "@/lib/log";
import type { Actor } from "@/auth/actor";

export async function runOwnedJob(
  supabase: SupabaseClient,
  input: {
    actor: Actor;
    type: JobType;
    inputRef: string;
    idempotencyKey?: string;
  },
  work: () => Promise<void>,
): Promise<{ id: string; correlationId: string }> {
  const correlationId = crypto.randomUUID();
  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      user_id: input.actor.userId,
      type: input.type,
      state: "queued",
      input_ref: input.inputRef,
      correlation_id: correlationId,
      max_attempts: JOB_MAX_ATTEMPTS,
      idempotency_key: input.idempotencyKey ?? null,
    })
    .select("id, attempts, max_attempts")
    .single();

  if (error || !job) {
    logError("jobs.enqueue_failed", { type: input.type, code: error?.code });
    throw new Error("JOB_ENQUEUE_FAILED");
  }

  await supabase
    .from("jobs")
    .update({ state: "processing", attempts: (job.attempts as number) + 1 })
    .eq("id", job.id)
    .eq("user_id", input.actor.userId);

  logInfo("jobs.started", { jobId: job.id, type: input.type, correlationId });

  try {
    await work();
    await supabase
      .from("jobs")
      .update({ state: "completed", error_code: null })
      .eq("id", job.id)
      .eq("user_id", input.actor.userId);
    logInfo("jobs.completed", { jobId: job.id, type: input.type, correlationId });
    return { id: job.id as string, correlationId };
  } catch (cause) {
    const errorCode = cause instanceof Error ? cause.message.slice(0, 80) : "JOB_FAILED";
    const attempts = ((job.attempts as number) ?? 0) + 1;
    const maxAttempts = (job.max_attempts as number) ?? JOB_MAX_ATTEMPTS;
    const retry = attempts < maxAttempts && isRetryableJobError(errorCode);
    const backoffMs = Math.min(60_000, 2 ** attempts * 1_000);
    await supabase
      .from("jobs")
      .update({
        state: retry ? "queued" : "failed",
        error_code: errorCode,
        last_error_at: new Date().toISOString(),
        next_attempt_at: retry ? new Date(Date.now() + backoffMs).toISOString() : null,
      })
      .eq("id", job.id)
      .eq("user_id", input.actor.userId);
    logError("jobs.failed", { jobId: job.id, type: input.type, correlationId, errorCode, retry });
    throw cause;
  }
}
