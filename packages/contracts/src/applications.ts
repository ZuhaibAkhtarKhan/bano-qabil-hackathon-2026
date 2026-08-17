import { z } from "zod";

import { uuidSchema } from "./common";
import { applicationStatusSchema } from "./enums";

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

export type GroundedDraft = z.infer<typeof groundedDraftSchema>;
export type AnswerVersion = z.infer<typeof answerVersionSchema>;
export type ApplicationRecord = z.infer<typeof applicationRecordSchema>;
export type SubmissionSnapshot = z.infer<typeof submissionSnapshotSchema>;
export type FillPlanMapping = z.infer<typeof fillPlanMappingSchema>;

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
