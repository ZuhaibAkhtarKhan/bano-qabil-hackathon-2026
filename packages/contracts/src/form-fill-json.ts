import { z } from "zod";

import { uuidSchema } from "./common";
import { BatchFieldInputSchema, BatchFieldTypeSchema } from "./fill-plan-batch";

/** Hazards detected on a host application page. */
export const FormPageHazardsSchema = z
  .object({
    captcha: z.boolean().default(false),
    captchaVendor: z.string().nullable().optional(),
    captchaMessage: z.string().nullable().optional(),
    accountCreation: z.boolean().default(false),
    accountMessage: z.string().nullable().optional(),
    unsupported: z.boolean().default(false),
    unsupportedReason: z.string().nullable().optional(),
    hasSubmitControl: z.boolean().nullable().optional(),
  })
  .partial()
  .default({});

/** One captured host control on an application page. */
export const FormFieldCaptureSchema = BatchFieldInputSchema.extend({
  fieldKey: z.string().max(180).optional(),
});

/** Page inventory JSON sent from extension or stored at save time. */
export const FormPageCaptureSchema = z.object({
  pageIndex: z.number().int().nonnegative().default(0),
  pageUrl: z.string().url().optional(),
  pageTitle: z.string().max(500).optional(),
  origin: z.string().url().optional(),
  hazards: FormPageHazardsSchema.optional(),
  fields: z.array(FormFieldCaptureSchema).max(80),
});

/** Why a field could not be auto-filled — mirrors Need You / fill UX. */
export const FormFieldResolutionKindSchema = z.enum([
  "filled",
  "need_you",
  "missing_memory",
  "upload_document",
  "eligibility",
  "host_filled",
  "blocked",
]);

/** LLM + server resolution for one field (apply + Need You). */
export const FormFieldResolutionSchema = z.object({
  fieldId: z.string(),
  /** Legacy apply path — filled values are applied; need_you leaves a gap/chip. */
  status: z.enum(["filled", "need_you"]),
  resolution: FormFieldResolutionKindSchema.optional(),
  reason: z.string().max(500).optional(),
  value: z.string().optional(),
  evidenceIds: z.array(z.string()).optional(),
  documentVersionId: uuidSchema.optional(),
  applyMode: z.enum(["auto", "chip", "ai_assistant", "skip"]).optional(),
});

/** Full fill plan returned after memory + LLM resolution. */
export const FormFillPlanResponseSchema = z.object({
  fillSessionId: uuidSchema.nullable().optional(),
  pageIndex: z.number().int().nonnegative().optional(),
  hazards: FormPageHazardsSchema.optional(),
  fields: z.array(FormFieldResolutionSchema),
});

export const FormFillPlanRequestSchema = FormPageCaptureSchema.extend({
  applicationId: uuidSchema,
});

export type FormPageHazards = z.infer<typeof FormPageHazardsSchema>;
export type FormFieldCapture = z.infer<typeof FormFieldCaptureSchema>;
export type FormPageCapture = z.infer<typeof FormPageCaptureSchema>;
export type FormFieldResolutionKind = z.infer<typeof FormFieldResolutionKindSchema>;
export type FormFieldResolution = z.infer<typeof FormFieldResolutionSchema>;
export type FormFillPlanResponse = z.infer<typeof FormFillPlanResponseSchema>;
export type FormFillPlanRequest = z.infer<typeof FormFillPlanRequestSchema>;
export type FormFieldType = z.infer<typeof BatchFieldTypeSchema>;
