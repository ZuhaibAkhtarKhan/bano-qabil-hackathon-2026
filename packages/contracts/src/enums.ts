import { z } from "zod";

export const verificationStatusSchema = z.enum(["unverified", "verified", "rejected"]);
export const documentTypeSchema = z.enum([
  "resume",
  "resume_variant",
  "cover_letter",
  "transcript",
  "certificate",
  "portfolio",
  "supporting_document",
  "other",
]);
export const documentVersionStatusSchema = z.enum([
  "uploading",
  "ready",
  "processing",
  "failed",
  "archived",
]);
export const opportunityCategorySchema = z.enum([
  "job",
  "internship",
  "scholarship",
  "hackathon",
  "grant",
  "fellowship",
  "university",
  "accelerator",
  "conference",
  "ambassador",
  "visa",
  "other",
]);
export const opportunitySourceSchema = z.enum(["url", "manual", "extension", "discovery"]);
export const applicationStatusSchema = z.enum([
  "saved",
  "analyzing",
  "ready_to_apply",
  "in_progress",
  "review_required",
  "draft",
  "preparing",
  "ready",
  "submitted",
  "under_review",
  "assessment",
  "interview",
  "accepted",
  "offer",
  "rejected",
  "withdrawn",
  "archived",
]);
export const eligibilityStateSchema = z.enum(["met", "not_met", "partial", "unclear", "not_evaluated"]);
export const jobStateSchema = z.enum([
  "queued",
  "running",
  "processing",
  "succeeded",
  "completed",
  "failed",
]);
export const jobLifecycleSchema = z.enum(["queued", "processing", "completed", "failed"]);
export const jobTypeSchema = z.enum([
  "document_extract",
  "document_embed",
  "opportunity_analyze",
  "eligibility_evaluate",
  "answer_draft",
  "resume_match",
  "notification_dispatch",
  "account_export",
  "email_sync",
  "calendar_sync",
  "deadline_monitor",
  "embedding_index",
]);
export const experienceKindSchema = z.enum([
  "education",
  "employment",
  "project",
  "leadership",
  "volunteering",
  "achievement",
  "certification",
  "research",
]);

export const memoryCategorySchema = z.enum([
  "personal",
  "education",
  "skills",
  "projects",
  "experience",
  "achievements",
  "certifications",
  "leadership",
  "research",
  "links",
  "supporting",
]);

export const extractionStatusSchema = z.enum(["manual", "extracted", "user_edited"]);
export const memoryConflictStatusSchema = z.enum(["open", "resolved"]);
export const reminderChannelSchema = z.enum(["in_app", "email"]);
export const reminderStatusSchema = z.enum(["scheduled", "sent", "cancelled"]);

export type VerificationStatus = z.infer<typeof verificationStatusSchema>;
export type DocumentType = z.infer<typeof documentTypeSchema>;
export type DocumentVersionStatus = z.infer<typeof documentVersionStatusSchema>;
export type OpportunityCategory = z.infer<typeof opportunityCategorySchema>;
export type OpportunitySource = z.infer<typeof opportunitySourceSchema>;
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;
export type EligibilityState = z.infer<typeof eligibilityStateSchema>;
export type JobState = z.infer<typeof jobStateSchema>;
export type JobLifecycle = z.infer<typeof jobLifecycleSchema>;
export type JobType = z.infer<typeof jobTypeSchema>;
export type ExperienceKind = z.infer<typeof experienceKindSchema>;
export type MemoryCategory = z.infer<typeof memoryCategorySchema>;
export type ExtractionStatus = z.infer<typeof extractionStatusSchema>;
export type MemoryConflictStatus = z.infer<typeof memoryConflictStatusSchema>;
export type ReminderChannel = z.infer<typeof reminderChannelSchema>;
export type ReminderStatus = z.infer<typeof reminderStatusSchema>;

export const APPLICATION_LIFECYCLE: readonly ApplicationStatus[] = [
  "saved",
  "analyzing",
  "ready_to_apply",
  "in_progress",
  "review_required",
  "submitted",
  "under_review",
  "interview",
  "accepted",
  "rejected",
  "draft",
  "preparing",
  "ready",
  "assessment",
  "offer",
  "withdrawn",
  "archived",
] as const;
