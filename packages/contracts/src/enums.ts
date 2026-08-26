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
  "identity_document",
  "family_document",
  "other",
]);

export const DOCUMENT_TYPE_LABELS: Record<z.infer<typeof documentTypeSchema>, string> = {
  resume: "Resume / CV",
  resume_variant: "Resume variant",
  cover_letter: "Cover letter",
  transcript: "Transcript",
  certificate: "Certificate",
  portfolio: "Portfolio",
  supporting_document: "Supporting document",
  identity_document: "CNIC / national ID",
  family_document: "B-form / family document",
  other: "Other application document",
};
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
export const eligibilityStateSchema = z.enum([
  "met",
  "not_met",
  "unclear",
  "not_evaluated",
  "partial",
  "needs_confirmation",
]);
export const requirementKindSchema = z.enum([
  "education",
  "degree",
  "graduation_year",
  "location",
  "experience",
  "skills",
  "availability",
  "other",
]);
export const resumeTrackSchema = z.enum([
  "software_engineering",
  "ai_ml",
  "web_development",
  "research",
  "general",
]);
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
  "opportunity_discover",
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

export const notificationStateSchema = z.enum([
  "incomplete",
  "deadline_approaching",
  "human_action_required",
  "answer_required",
  "document_required",
  "submission_ready",
  "submission_completed",
  "submission_failed",
]);

export const notificationCategorySchema = z.enum([
  "deadline_approaching",
  "application_incomplete",
  "missing_information",
  "missing_document",
  "answer_ready",
  "answer_needs_review",
  "captcha_required",
  "account_action_required",
  "submission_completed",
  "submission_failed",
  "interview_detected",
  "interview_reminder",
  "application_status_changed",
]);
export const notificationPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const notificationChannelSchema = z.enum(["in_app", "email"]);
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;
export type NotificationPriority = z.infer<typeof notificationPrioritySchema>;
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const deadlineUrgencySchema = z.enum(["none", "upcoming", "soon", "imminent", "overdue"]);

export type NotificationState = z.infer<typeof notificationStateSchema>;
export type DeadlineUrgency = z.infer<typeof deadlineUrgencySchema>;

export type VerificationStatus = z.infer<typeof verificationStatusSchema>;
export type DocumentType = z.infer<typeof documentTypeSchema>;
export type DocumentVersionStatus = z.infer<typeof documentVersionStatusSchema>;
export type OpportunityCategory = z.infer<typeof opportunityCategorySchema>;
export type OpportunitySource = z.infer<typeof opportunitySourceSchema>;
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;
export type EligibilityState = z.infer<typeof eligibilityStateSchema>;
export type RequirementKind = z.infer<typeof requirementKindSchema>;
export type ResumeTrack = z.infer<typeof resumeTrackSchema>;
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
