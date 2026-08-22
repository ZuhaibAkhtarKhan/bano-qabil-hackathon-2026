import { z } from "zod";

import { uuidSchema } from "./common";
import { documentTypeSchema, documentVersionStatusSchema, extractionStatusSchema, verificationStatusSchema } from "./enums";

export const evidenceItemSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  title: z.string().min(1),
  kind: z.string().min(1),
  organization: z.string().nullable(),
  situation: z.string().nullable(),
  action: z.string().nullable(),
  outcome: z.string().nullable(),
  skills: z.array(z.string()),
  source: z.string().nullable(),
  verificationStatus: verificationStatusSchema,
  excludedFromAi: z.boolean(),
  extractionStatus: extractionStatusSchema.optional(),
  sourceDocumentId: uuidSchema.nullable().optional(),
  sourceLocation: z.string().nullable().optional(),
  factKey: z.string().nullable().optional(),
});

export const documentVersionSchema = z.object({
  id: uuidSchema,
  documentId: uuidSchema,
  userId: uuidSchema,
  versionLabel: z.string().min(1),
  storagePath: z.string().min(1),
  fileHash: z.string().min(1),
  mimeType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  status: documentVersionStatusSchema,
  originalFilename: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  createdAt: z.string().datetime().optional(),
});

export const documentRecordSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  type: documentTypeSchema,
  label: z.string().min(1),
  currentVersionId: uuidSchema.nullable(),
});

export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type DocumentVersion = z.infer<typeof documentVersionSchema>;
export type DocumentRecord = z.infer<typeof documentRecordSchema>;
