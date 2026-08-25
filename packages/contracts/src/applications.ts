import { z } from "zod";

import { uuidSchema } from "./common";
import { applicationStatusSchema } from "./enums";

// ─── Answer states ────────────────────────────────────────────────────────────

export const answerStateSchema = z.enum([
  "ai_generated",
  "user_edited",
  "approved",
  "rejected",
  "needs_review",
]);

export const generationIntentSchema = z.enum(["draft", "shorten", "expand", "adjust_tone"]);
export const toneStyleSchema = z.enum(["formal", "enthusiastic", "concise", "detailed"]);

// ─── Question record ──────────────────────────────────────────────────────────

export const questionRecordSchema = z.object({
  id: uuidSchema,
  opportunityId: uuidSchema,
  prompt: z.string(),
  kind: z.string(),
  limitValue: z.number().nullable(),
  limitUnit: z.string().nullable(),
  required: z.boolean(),
});

// ─── Claim flag ───────────────────────────────────────────────────────────────

export const claimFlagSchema = z.object({
  claim: z.string(),
  supported: z.boolean(),
  evidenceId: uuidSchema.nullable(),
  reason: z.string(),
});

// ─── Answer record (extended) ─────────────────────────────────────────────────

export const answerRecordSchema = z.object({
  id: uuidSchema,
  applicationId: uuidSchema,
  questionId: uuidSchema,
  state: answerStateSchema,
  originalAiText: z.string().nullable(),
  userEditedText: z.string().nullable(),
  approvedText: z.string().nullable(),
  evidenceIds: z.array(uuidSchema),
  claimFlags: z.array(claimFlagSchema),
  missingFacts: z.array(z.string()),
  warnings: z.array(z.string()),
  groundingScore: z.number().min(0).max(1),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  generationCount: z.number().int().nonnegative(),
});

export type AnswerState = z.infer<typeof answerStateSchema>;
export type GenerationIntent = z.infer<typeof generationIntentSchema>;
export type ToneStyle = z.infer<typeof toneStyleSchema>;
export type QuestionRecord = z.infer<typeof questionRecordSchema>;
export type ClaimFlag = z.infer<typeof claimFlagSchema>;
export type AnswerRecord = z.infer<typeof answerRecordSchema>;

export const groundedDraftSchema = z.object({
  text: z.string(),
  evidenceIds: z.array(uuidSchema),
  missingFacts: z.array(z.string()),
  warnings: z.array(z.string()),
  characterCount: z.number().int().nonnegative(),
});

export const answerVersionSchema = z.object({
  id: uuidSchema,
  questionId: uuidSchema,
  text: z.string(),
  evidenceIds: z.array(uuidSchema),
  approved: z.boolean(),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
});

export const applicationRecordSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  opportunityId: uuidSchema,
  status: applicationStatusSchema,
  deadlineAt: z.string().datetime().nullable(),
  nextAction: z.string().nullable(),
});

export const submissionSnapshotSchema = z.object({
  id: uuidSchema,
  applicationId: uuidSchema,
  submittedAt: z.string().datetime(),
  answerManifest: z.array(
    z.object({
      questionId: uuidSchema,
      answerVersionId: uuidSchema,
    }),
  ),
  documentManifest: z.array(
    z.object({
      documentId: uuidSchema,
      documentVersionId: uuidSchema,
    }),
  ),
  opportunitySnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  evidenceManifest: z.array(uuidSchema).nullable().optional(),
  fieldManifest: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
  idempotencyKey: z.string().nullable().optional(),
  guardResult: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const fillPlanMappingSchema = z.object({
  fieldKey: z.string().min(1),
  label: z.string().min(1),
  value: z.string(),
  source: z.string(),
  confidence: z.number().min(0).max(1),
  excludedByDefault: z.boolean(),
  sensitive: z.boolean(),
});

export const fillSessionEndReasonSchema = z.enum([
  "stopped",
  "tab_closed",
  "origin_left",
  "submitted_detected",
]);

export const fillSessionCapturedFieldSchema = z.object({
  fieldKey: z.string().min(1).max(180),
  label: z.string().max(180).default(""),
  value: z.string().max(4000),
  required: z.boolean().optional().default(false),
  fieldType: z.string().max(40).optional(),
});

export const fillSessionEndRequestSchema = z.object({
  reason: fillSessionEndReasonSchema,
  origin: z.string().url().optional(),
  fillSessionId: uuidSchema.optional(),
  pageUrl: z.string().url().optional(),
  pageText: z.string().max(50_000).optional(),
  fields: z.array(fillSessionCapturedFieldSchema).max(120).default([]),
});

export const fillSessionEndResponseSchema = z.object({
  applicationId: uuidSchema,
  status: applicationStatusSchema,
  nextAction: z.string(),
  savedFieldCount: z.number().int().nonnegative(),
  needsYouCount: z.number().int().nonnegative(),
  submitted: z.boolean(),
  submissionSignal: z.string().nullable(),
});

export type GroundedDraft = z.infer<typeof groundedDraftSchema>;
export type AnswerVersion = z.infer<typeof answerVersionSchema>;
export type ApplicationRecord = z.infer<typeof applicationRecordSchema>;
export type SubmissionSnapshot = z.infer<typeof submissionSnapshotSchema>;
export type FillPlanMapping = z.infer<typeof fillPlanMappingSchema>;
export type FillSessionEndReason = z.infer<typeof fillSessionEndReasonSchema>;
export type FillSessionCapturedField = z.infer<typeof fillSessionCapturedFieldSchema>;
export type FillSessionEndRequest = z.infer<typeof fillSessionEndRequestSchema>;
export type FillSessionEndResponse = z.infer<typeof fillSessionEndResponseSchema>;

export function assertDraftIsGrounded(draft: GroundedDraft): string[] {
  const issues: string[] = [];
  if (draft.text.trim().length > 0 && draft.evidenceIds.length === 0) {
    issues.push("NO_EVIDENCE");
  }
  if (draft.characterCount !== draft.text.length) {
    issues.push("CHARACTER_COUNT_MISMATCH");
  }
  return issues;
}
