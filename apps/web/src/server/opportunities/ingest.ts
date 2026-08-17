import type { OpportunitySource } from "@1apply/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { runOwnedJob } from "@/server/jobs/runner";
import {
  ensureApplication,
  markOpportunityAnalysisFailed,
  persistOpportunityAnalysis,
  runOpportunityAnalysisJob,
} from "@/server/opportunities/analyze";
import { opportunityExtractionSchema } from "@/infra/ai/openai";
import { opportunityCategorySchema } from "@1apply/contracts";

export type IngestPageInput = {
  supabase: SupabaseClient;
  actor: Actor;
  userId: string;
  source: OpportunitySource;
  sourceUrl: string;
  canonicalUrl: string;
  pageText: string;
  pageTitle: string;
  metadata?: Record<string, unknown>;
};

export async function findDuplicateOpportunity(supabase: SupabaseClient, userId: string, canonicalUrl: string) {
  const { data } = await supabase
    .from("opportunities")
    .select("id")
    .eq("user_id", userId)
    .eq("canonical_url", canonicalUrl)
    .maybeSingle();
  return data?.id as string | undefined;
}

export async function ingestOpportunityPage(input: IngestPageInput): Promise<{
  opportunityId: string;
  applicationId: string;
  jobId: string;
  duplicate: boolean;
}> {
  const duplicateId = await findDuplicateOpportunity(input.supabase, input.userId, input.canonicalUrl);
  if (duplicateId) {
    const applicationId = await ensureApplication(input.supabase, input.userId, duplicateId, null);
    return { opportunityId: duplicateId, applicationId, jobId: "", duplicate: true };
  }

  const { data: opportunity, error } = await input.supabase
    .from("opportunities")
    .insert({
      user_id: input.userId,
      source: input.source,
      source_url: input.sourceUrl,
      canonical_url: input.canonicalUrl,
      title: (input.metadata?.title as string | undefined)?.slice(0, 180) || input.pageTitle.slice(0, 180) || input.canonicalUrl,
      category: "other",
      raw_excerpt: input.pageText.slice(0, 12_000),
      analysis_status: "pending",
      metadata: input.metadata ?? {},
    })
    .select("id")
    .single();

  if (error || !opportunity) throw new Error("OPPORTUNITY_CREATE_FAILED");

  const applicationId = await ensureApplication(input.supabase, input.userId, opportunity.id, null);

  const { id: jobId } = await runOwnedJob(
    input.supabase,
    { actor: input.actor, type: "opportunity_analyze", inputRef: opportunity.id },
    async () => {
      await runOpportunityAnalysisJob({
        supabase: input.supabase,
        actor: input.actor,
        userId: input.userId,
        opportunityId: opportunity.id,
        applicationId,
        pageText: input.pageText,
        sourceUrl: input.canonicalUrl,
        source: input.source,
      });
    },
  );

  return { opportunityId: opportunity.id, applicationId, jobId, duplicate: false };
}

export async function createManualOpportunityRecord(input: {
  supabase: SupabaseClient;
  userId: string;
  title: string;
  organization: string | null;
  category: string;
  location: string | null;
  deadlineAt: string | null;
  notes: string | null;
  requirements: string[];
  questions: string[];
  documents: string[];
}) {
  const category = opportunityCategorySchema.parse(input.category);

  const { data: opportunity, error } = await input.supabase
    .from("opportunities")
    .insert({
      user_id: input.userId,
      source: "manual",
      title: input.title,
      organization: input.organization,
      category,
      location: input.location,
      deadline_at: input.deadlineAt,
      raw_excerpt: input.notes,
      analysis_status: "needs_input",
      analyzed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !opportunity) throw new Error("OPPORTUNITY_CREATE_FAILED");

  const applicationId = await ensureApplication(input.supabase, input.userId, opportunity.id, input.deadlineAt);

  const extracted = opportunityExtractionSchema.parse({
    title: input.title,
    organization: input.organization,
    category,
    location: input.location,
    deadline: input.deadlineAt,
    eligibilityCriteria: [],
    skills: [],
    experienceRequirements: [],
    requirements: input.requirements.map((text) => ({ text, hard: false, kind: "general" as const })),
    questions: input.questions.map((prompt) => ({ prompt, limitValue: null, limitUnit: null })),
    requiredDocuments: input.documents.map((label) => ({ label, required: true })),
    importantDates: [],
  });

  await persistOpportunityAnalysis({
    supabase: input.supabase,
    userId: input.userId,
    opportunityId: opportunity.id,
    applicationId,
    extracted,
    source: "manual",
  });

  return { opportunityId: opportunity.id, applicationId };
}

export async function ingestPastedContent(input: {
  supabase: SupabaseClient;
  actor: Actor;
  userId: string;
  title: string;
  pastedText: string;
  sourceUrl?: string | null;
}) {
  const canonicalUrl = input.sourceUrl?.trim() || `manual://${crypto.randomUUID()}`;

  const { data: opportunity, error } = await input.supabase
    .from("opportunities")
    .insert({
      user_id: input.userId,
      source: "manual",
      source_url: input.sourceUrl ?? null,
      canonical_url: canonicalUrl,
      title: input.title.slice(0, 180),
      category: "other",
      raw_excerpt: input.pastedText.slice(0, 12_000),
      analysis_status: "pending",
    })
    .select("id")
    .single();

  if (error || !opportunity) throw new Error("OPPORTUNITY_CREATE_FAILED");

  const applicationId = await ensureApplication(input.supabase, input.userId, opportunity.id, null);

  const { id: jobId } = await runOwnedJob(
    input.supabase,
    { actor: input.actor, type: "opportunity_analyze", inputRef: opportunity.id },
    async () => {
      try {
        await runOpportunityAnalysisJob({
          supabase: input.supabase,
          actor: input.actor,
          userId: input.userId,
          opportunityId: opportunity.id,
          applicationId,
          pageText: input.pastedText,
          sourceUrl: input.sourceUrl ?? undefined,
          source: "manual",
        });
      } catch {
        await markOpportunityAnalysisFailed(input.supabase, opportunity.id, "analysis_failed");
      }
    },
  );

  return { opportunityId: opportunity.id, applicationId, jobId };
}
