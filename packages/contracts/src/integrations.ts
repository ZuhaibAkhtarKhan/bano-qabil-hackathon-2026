import { z } from "zod";

import { uuidSchema } from "./common";

export const emailCategorySchema = z.enum([
  "application_received",
  "interview_invitation",
  "assessment",
  "rejection",
  "offer",
  "follow_up_request",
  "irrelevant",
]);

export const emailEventRecordSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  integrationId: uuidSchema.nullable(),
  applicationId: uuidSchema.nullable(),
  occurredAt: z.string().datetime(),
  externalId: z.string().nullable(),
  eventKind: emailCategorySchema,
  subject: z.string().nullable(),
  fromAddress: z.string().nullable(),
  snippet: z.string().nullable(),
  senderDomain: z.string().nullable(),
  associationConfidence: z.number().nullable(),
  associationSignals: z.array(z.string()).nullable(),
  interviewDetected: z.boolean(),
  interviewDateHints: z.array(z.string()),
  calendarEventId: uuidSchema.nullable(),
  userCorrected: z.boolean(),
  createdAt: z.string().datetime(),
});

export const calendarEventRecordSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  integrationId: uuidSchema.nullable(),
  applicationId: uuidSchema.nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable(),
  title: z.string(),
  externalId: z.string().nullable(),
  location: z.string().nullable(),
  meetingUrl: z.string().nullable(),
  timezone: z.string().nullable(),
  confirmed: z.boolean(),
  emailEventId: uuidSchema.nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const integrationTokenSchema = z.object({
  integrationId: uuidSchema,
  accessToken: z.string(),
  refreshToken: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
  scopes: z.array(z.string()),
});

export const oauthStateSchema = z.object({
  provider: z.enum(["google"]),
  kind: z.enum(["gmail", "google_calendar"]),
  userId: uuidSchema,
  returnTo: z.string(),
  nonce: z.string(),
});

export type EmailCategory = z.infer<typeof emailCategorySchema>;
export type EmailEventRecord = z.infer<typeof emailEventRecordSchema>;
export type CalendarEventRecord = z.infer<typeof calendarEventRecordSchema>;
export type IntegrationToken = z.infer<typeof integrationTokenSchema>;
export type OAuthState = z.infer<typeof oauthStateSchema>;
