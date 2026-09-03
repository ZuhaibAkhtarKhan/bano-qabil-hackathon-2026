import { z } from "zod";

import { uuidSchema } from "./common";

export const BATCH_FIELD_TYPES = [
  "text",
  "textarea",
  "select",
  "radio",
  "checkbox",
  "file",
  "contenteditable",
  "date",
  "number",
  "url",
] as const;

export const BatchFieldTypeSchema = z.enum(BATCH_FIELD_TYPES);

/** Map HTML / host control types onto the batch fill enum (email/tel → text, etc.). */
export function coerceBatchFieldType(value: unknown): (typeof BATCH_FIELD_TYPES)[number] {
  const type = String(value ?? "text").toLowerCase().trim();
  if ((BATCH_FIELD_TYPES as readonly string[]).includes(type)) {
    return type as (typeof BATCH_FIELD_TYPES)[number];
  }
  if (type === "datetime-local" || type === "month" || type === "week" || type === "time") return "date";
  if (type === "range") return "number";
  if (type === "multi-select") return "select";
  return "text";
}

export const BatchFieldInputSchema = z.object({
  fieldId: z.string(),
  type: z.preprocess(coerceBatchFieldType, BatchFieldTypeSchema),
  label: z.string(),
  name: z.string().optional(),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  maxLength: z.number().optional(),
  currentValue: z.string().optional(),
  nearbyText: z.string().optional(),
  placeholder: z.string().optional(),
  ariaLabel: z.string().optional(),
});

export const BatchFillRequestSchema = z.object({
  applicationId: uuidSchema,
  pageIndex: z.number().int().nonnegative(),
  fields: z.array(BatchFieldInputSchema),
});

export const BatchFieldResultSchema = z.object({
  fieldId: z.string(),
  status: z.enum(["filled", "need_you"]),
  value: z.string().optional(),
  evidenceIds: z.array(z.string()).optional(),
  documentVersionId: uuidSchema.optional(),
  resolution: z
    .enum(["filled", "need_you", "missing_memory", "upload_document", "eligibility", "host_filled", "blocked"])
    .optional(),
  reason: z.string().max(500).optional(),
  applyMode: z.enum(["auto", "chip", "ai_assistant", "skip"]).optional(),
});

export const BatchFillResponseSchema = z.object({
  fields: z.array(BatchFieldResultSchema),
});

export type BatchFieldType = z.infer<typeof BatchFieldTypeSchema>;
export type BatchFieldInput = z.infer<typeof BatchFieldInputSchema>;
export type BatchFillRequest = z.infer<typeof BatchFillRequestSchema>;
export type BatchFieldResult = z.infer<typeof BatchFieldResultSchema>;
export type BatchFillResponse = z.infer<typeof BatchFillResponseSchema>;
