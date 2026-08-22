import { opportunityCategorySchema, type OpportunitySource } from "@1apply/contracts";
import { normalizeOpportunityUrl, urlsLikelySame } from "@1apply/domain";
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
import { evaluateApplicationIntelligence } from "@/server/intelligence/evaluate";

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
    .select("id, canonical_url, source_url")
    .eq("user_id", userId);

  const match = (data ?? []).find((row) => {
    const canonical = String(row.canonical_url ?? "");
    const source = String(row.source_url ?? "");
    return (
      (canonical && urlsLikelySame(canonicalUrl, canonical)) ||
      (source && urlsLikelySame(canonicalUrl, source))
    );
  });
  return match?.id as string | undefined;
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
      canonical_url: normalizeOpportunityUrl(input.canonicalUrl),
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

export async function createFetchFailedOpportunity(input: {
  supabase: SupabaseClient;
  actor: Actor;
  userId: string;
  sourceUrl: string;
  canonicalUrl: string;
  fetchError: string;
}) {
  const duplicateId = await findDuplicateOpportunity(input.supabase, input.userId, input.canonicalUrl);
  if (duplicateId) {
    const applicationId = await ensureApplication(input.supabase, input.userId, duplicateId, null);
    return { opportunityId: duplicateId, applicationId, duplicate: true };
  }

  let hostname = input.canonicalUrl;
  try {
    hostname = new URL(input.canonicalUrl).hostname;
  } catch {
    hostname = input.canonicalUrl.slice(0, 80);
  }

  const { data: opportunity, error } = await input.supabase
    .from("opportunities")
    .insert({
      user_id: input.userId,
      source: "url",
      source_url: input.sourceUrl,
      canonical_url: normalizeOpportunityUrl(input.canonicalUrl),
      title: hostname.slice(0, 180),
      category: "other",
      analysis_status: "needs_input",
      metadata: {
        fetchError: input.fetchError,
        fetchFailedAt: new Date().toISOString(),
      },
    })
    .select("id")
    .single();

  if (error || !opportunity) throw new Error("OPPORTUNITY_CREATE_FAILED");

  const applicationId = await ensureApplication(input.supabase, input.userId, opportunity.id, null);
  return { opportunityId: opportunity.id as string, applicationId, duplicate: false };
}

export async function pasteIntoOpportunity(input: {
  supabase: SupabaseClient;
  actor: Actor;
  userId: string;
  opportunityId: string;
  pastedText: string;
  title?: string | null;
}) {
  const { data: opportunity } = await input.supabase
    .from("opportunities")
    .select("id, title, metadata, source_url, canonical_url")
    .eq("id", input.opportunityId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (!opportunity) throw new Error("OPPORTUNITY_NOT_FOUND");

  const applicationId = await ensureApplication(input.supabase, input.userId, opportunity.id, null);
  const previousMetadata = ((opportunity.metadata as Record<string, unknown> | null) ?? {});
  const keptMetadata = { ...previousMetadata };
  delete keptMetadata.fetchError;
  const metadata = {
    ...keptMetadata,
    pastedAt: new Date().toISOString(),
  };

  await input.supabase
    .from("opportunities")
    .update({
      title: input.title?.trim()?.slice(0, 180) || opportunity.title,
      raw_excerpt: input.pastedText.slice(0, 12_000),
      analysis_status: "pending",
      metadata,
    })
    .eq("id", opportunity.id);

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
          sourceUrl: (opportunity.canonical_url as string | null) ?? (opportunity.source_url as string | null) ?? undefined,
          source: "manual",
        });
      } catch {
        await markOpportunityAnalysisFailed(input.supabase, opportunity.id, "analysis_failed");
      }
    },
  );

  return { opportunityId: opportunity.id as string, applicationId, jobId };
}

export async function createManualOpportunityRecord(input: {
  supabase: SupabaseClient;
  actor: Actor;
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
  await evaluateApplicationIntelligence(input.supabase, input.actor, applicationId, opportunity.id);

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
