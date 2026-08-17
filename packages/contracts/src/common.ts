import { z } from "zod";

export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const uuidSchema = z.string().uuid();

export const jsonObjectSchema = z.record(z.string(), z.unknown());

export function createApiEnvelopeSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    data: dataSchema.nullable(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.unknown().optional(),
      })
      .nullable(),
    requestId: z.string(),
  });
}

export const errorCodes = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  UNSAFE_URL: "UNSAFE_URL",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  JOB_FAILED: "JOB_FAILED",
} as const;

export type ErrorCode = (typeof errorCodes)[keyof typeof errorCodes];
