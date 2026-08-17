import { z } from "zod";

import { uuidSchema } from "./common";
import { applicationStatusSchema, jobLifecycleSchema } from "./enums";

export const envSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_MODEL: z.string().optional(),
  EMBEDDING_PROVIDER: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  STORAGE_BUCKET: z.string().optional(),
  NEXT_PUBLIC_EXTENSION_ORIGIN: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GMAIL_SYNC_ENABLED: z.enum(["true", "false"]).optional(),
  CALENDAR_SYNC_ENABLED: z.enum(["true", "false"]).optional(),
});

export const skillRecordSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  name: z.string().min(1),
  normalizedName: z.string().min(1),
});

export const evidenceSourceSchema = z.object({
  id: uuidSchema,
  evidenceId: uuidSchema,
  sourceKind: z.enum(["document_version", "manual", "import", "url"]),
  sourceRef: z.string().nullable(),
});

export const profileLinkSchema = z.object({
  id: uuidSchema,
  kind: z.enum(["linkedin", "github", "portfolio", "other"]),
  url: z.string().url(),
  label: z.string().nullable(),
});

export const applicationEventSchema = z.object({
  id: uuidSchema,
  applicationId: uuidSchema,
  eventName: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export const applicationStatusHistorySchema = z.object({
  id: uuidSchema,
  applicationId: uuidSchema,
  fromStatus: applicationStatusSchema.nullable(),
  toStatus: applicationStatusSchema,
});

export const integrationRecordSchema = z.object({
  id: uuidSchema,
  provider: z.string().min(1),
  kind: z.enum(["gmail", "google_calendar", "oauth"]),
  status: z.enum(["disconnected", "connected", "error", "revoked"]),
  scopes: z.array(z.string()),
  accountLabel: z.string().nullable(),
});

export const aiRunSchema = z.object({
  id: uuidSchema,
  purpose: z.string().min(1),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  inputEvidenceIds: z.array(uuidSchema),
  status: jobLifecycleSchema,
  errorCode: z.string().nullable(),
});

export const embeddingRecordSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  sourceTable: z.enum(["evidence_items", "document_chunks", "experiences"]),
  sourceId: uuidSchema,
  content: z.string().min(1),
});

export type SkillRecord = z.infer<typeof skillRecordSchema>;
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;
export type ProfileLink = z.infer<typeof profileLinkSchema>;
export type ApplicationEvent = z.infer<typeof applicationEventSchema>;
export type ApplicationStatusHistory = z.infer<typeof applicationStatusHistorySchema>;
export type IntegrationRecord = z.infer<typeof integrationRecordSchema>;
export type AiRun = z.infer<typeof aiRunSchema>;
export type EmbeddingRecord = z.infer<typeof embeddingRecordSchema>;
