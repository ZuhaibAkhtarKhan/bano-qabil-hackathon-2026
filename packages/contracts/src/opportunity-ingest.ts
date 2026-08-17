import { z } from "zod";

import { opportunityCategorySchema, opportunitySourceSchema } from "./enums";

export const opportunityIngestRequestSchema = z.object({
  url: z.string().url(),
  source: opportunitySourceSchema.default("extension"),
  metadata: z
    .object({
      title: z.string().optional(),
      excerpt: z.string().optional(),
      pageText: z.string().optional(),
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
  keywords: z.array(z.string()).default([]),
});

export type OpportunityIngestRequest = z.infer<typeof opportunityIngestRequestSchema>;
export type OpportunityDiscoveryRequest = z.infer<typeof opportunityDiscoveryRequestSchema>;
export type DiscoveryFilters = z.infer<typeof discoveryFiltersSchema>;
