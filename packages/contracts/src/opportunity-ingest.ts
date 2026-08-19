import { z } from "zod";

import { opportunityCategorySchema, opportunitySourceSchema } from "./enums";

export const opportunityIngestRequestSchema = z.object({
  url: z.string().url().max(2048),
  source: opportunitySourceSchema.default("extension"),
  metadata: z
    .object({
      title: z.string().max(500).optional(),
      excerpt: z.string().max(8_000).optional(),
      pageText: z.string().max(20_000).optional(),
    })
    .optional(),
});

export const opportunityDiscoveryRequestSchema = z.object({
  query: z.string().min(8).max(500),
});

export const discoveryFiltersSchema = z.object({
  categories: z.array(opportunityCategorySchema).default([]),
  locations: z.array(z.string()).default([]),
  remoteOk: z.boolean().default(false),
  educationLevel: z.string().nullable().optional(),
  experienceLevel: z.string().nullable().optional(),
  domain: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  otherConstraints: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
});

export type OpportunityIngestRequest = z.infer<typeof opportunityIngestRequestSchema>;
export type OpportunityDiscoveryRequest = z.infer<typeof opportunityDiscoveryRequestSchema>;
export type DiscoveryFilters = z.infer<typeof discoveryFiltersSchema>;
