import { z } from "zod";

import { uuidSchema } from "./common";
import {
  eligibilityStateSchema,
  opportunityCategorySchema,
  opportunitySourceSchema,
  requirementKindSchema,
  resumeTrackSchema,
} from "./enums";

export const opportunityRecordSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  source: opportunitySourceSchema,
  sourceUrl: z.string().url().nullable(),
  title: z.string().min(1),
  organization: z.string().nullable(),
  category: opportunityCategorySchema,
  location: z.string().nullable(),
  deadlineAt: z.string().datetime().nullable(),
  analysisStatus: z.enum(["pending", "ready", "failed", "needs_input"]),
});

export const requirementRecordSchema = z.object({
  id: uuidSchema,
  opportunityId: uuidSchema,
  text: z.string().min(1),
  hard: z.boolean(),
  kind: requirementKindSchema.optional(),
  confidence: z.number().min(0).max(1),
  sourceSpan: z.string().nullable(),
});

export const eligibilityResultSchema = z.object({
  id: uuidSchema,
  applicationId: uuidSchema,
  requirementId: uuidSchema,
  state: eligibilityStateSchema,
  explanation: z.string().min(1),
  profileFactId: uuidSchema.nullable(),
});

export const fitIndexSchema = z.object({
  score: z.number().min(0).max(100),
  skillsMatch: z.number().min(0).max(100),
  experienceMatch: z.number().min(0).max(100),
  educationMatch: z.number().min(0).max(100),
  projectRelevance: z.number().min(0).max(100),
  eligibility: z.number().min(0).max(100),
  missing: z.array(z.string()),
  strengths: z.array(z.string()).default([]),
  explanation: z.string().optional(),
  shouldApply: z.enum(["apply", "consider", "weak", "blocked"]).optional(),
});

export const resumeMatchSchema = z.object({
  documentId: uuidSchema,
  documentVersionId: uuidSchema,
  track: resumeTrackSchema,
  score: z.number().min(0).max(100),
  explanation: z.string(),
  recommended: z.boolean(),
  suggestion: z.string().nullable(),
});

export type OpportunityRecord = z.infer<typeof opportunityRecordSchema>;
export type RequirementRecord = z.infer<typeof requirementRecordSchema>;
export type EligibilityResult = z.infer<typeof eligibilityResultSchema>;
export type FitIndex = z.infer<typeof fitIndexSchema>;
export type ResumeMatch = z.infer<typeof resumeMatchSchema>;
