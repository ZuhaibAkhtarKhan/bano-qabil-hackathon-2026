import { z } from "zod";

import { uuidSchema } from "./common";
import { jobStateSchema, jobTypeSchema, type JobLifecycle, type JobState } from "./enums";

export const jobRecordSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  type: jobTypeSchema,
  state: jobStateSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  inputRef: z.string(),
  errorCode: z.string().nullable(),
  correlationId: z.string(),
  idempotencyKey: z.string().nullable(),
  nextAttemptAt: z.string().datetime().nullable(),
});

export type JobRecord = z.infer<typeof jobRecordSchema>;

export function toJobLifecycle(state: JobState): JobLifecycle {
  if (state === "running") return "processing";
  if (state === "succeeded") return "completed";
  if (state === "queued" || state === "processing" || state === "completed" || state === "failed") {
    return state;
  }
  return "failed";
}

export function isRetryableJobError(code: string): boolean {
  return ["AI_HTTP_FAILED", "AI_EMPTY", "JOB_ENQUEUE_FAILED", "PAGE_TOO_LARGE"].includes(code);
}
