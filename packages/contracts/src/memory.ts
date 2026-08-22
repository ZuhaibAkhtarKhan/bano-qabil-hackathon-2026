import { z } from "zod";

import { uuidSchema } from "./common";
import { extractionStatusSchema, memoryCategorySchema, verificationStatusSchema } from "./enums";

export const memoryFactSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  category: memoryCategorySchema,
  factKey: z.string().min(1),
  value: z.string().min(1),
  source: z.string().nullable(),
  sourceDocumentId: uuidSchema.nullable(),
  sourceLocation: z.string().nullable(),
  extractionStatus: extractionStatusSchema,
  verificationStatus: verificationStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const memoryConflictSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  factKey: z.string().min(1),
  category: memoryCategorySchema,
  status: z.enum(["open", "resolved"]),
  chosenFactId: uuidSchema.nullable(),
});

export type MemoryFact = z.infer<typeof memoryFactSchema>;
export type MemoryConflict = z.infer<typeof memoryConflictSchema>;
