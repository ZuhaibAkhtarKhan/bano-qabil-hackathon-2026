import type { OpportunitySource } from "@1apply/contracts";
import { discoveryFiltersSchema, opportunityCategorySchema } from "@1apply/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import type { Actor } from "@/auth/actor";
import {
  DISCOVERY_PARSE_INSTRUCTION,
  OPPORTUNITY_ANALYSIS_INSTRUCTION,
  wrapUntrustedPageContent,
} from "@/lib/opportunities/untrusted";
import { opportunityExtractionSchema, tryGetAiProvider } from "@/infra/ai/openai";

type Extraction = z.infer<typeof opportunityExtractionSchema>;

export function parseDeadline(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function mergeRequirementRows(extracted: Extraction) {
  const rows: Array<{ text: string; hard: boolean; kind: string; sourceSpan: string | null }> = [];

  for (const item of extracted.requirements) {
    rows.push({
      text: item.text,
      hard: item.hard,
      kind: item.kind ?? "general",
      sourceSpan: item.sourceSpan ?? null,
    });
  }
  for (const text of extracted.eligibilityCriteria) {
    rows.push({ text, hard: true, kind: "eligibility", sourceSpan: "eligibility" });
  }
  for (const text of extracted.skills) {
    rows.push({ text: `Skill: ${text}`, hard: false, kind: "skill", sourceSpan: "skills" });
  }
  for (const text of extracted.experienceRequirements) {
    rows.push({ text, hard: false, kind: "experience", sourceSpan: "experience" });
  }

  const seen = new Set<string>();
  return rows
    .filter((row) => {
      const key = row.text.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 40);
}

export async function extractOpportunityFromText(pageText: string, sourceUrl?: string): Promise<Extraction | null> {
  const provider = tryGetAiProvider();
  if (!provider) return null;

  try {
    const raw = await provider.completeStructured({
      schemaName: "opportunityExtraction",
      instruction: OPPORTUNITY_ANALYSIS_INSTRUCTION,
      untrustedData: wrapUntrustedPageContent(pageText, sourceUrl),
    });
    const parsed = opportunityExtractionSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function parseDiscoveryQuery(query: string) {
  const provider = tryGetAiProvider();
  if (!provider) {
    return discoveryFiltersSchema.parse({ keywords: query.split(/\s+/).slice(0, 12) });
  }

  try {
    const raw = await provider.completeStructured({
      schemaName: "discoveryFilters",
      instruction: DISCOVERY_PARSE_INSTRUCTION,
      untrustedData: wrapUntrustedPageContent(query),
    });
    const parsed = discoveryFiltersSchema.safeParse(raw);
    return parsed.success ? parsed.data : discoveryFiltersSchema.parse({ keywords: [query] });
  } catch {
    return discoveryFiltersSchema.parse({ keywords: [query] });
  }
}

export async function persistOpportunityAnalysis(input: {
  supabase: SupabaseClient;
  userId: string;
  opportunityId: string;
  applicationId: string;
  extracted: Extraction;
  source: OpportunitySource;
}) {
  const category = opportunityCategorySchema.safeParse(input.extracted.category);
  const deadlineAt = parseDeadline(input.extracted.deadline);
  const requirementRows = mergeRequirementRows(input.extracted);
  const hasStructure =
    requirementRows.length > 0 ||
    input.extracted.questions.length > 0 ||
    input.extracted.requiredDocuments.length > 0;

  await input.supabase
    .from("opportunities")
    .update({
      title: input.extracted.title.slice(0, 180),
      organization: input.extracted.organization,
      category: category.success ? category.data : "other",
      location: input.extracted.location,
      deadline_at: deadlineAt,
      analysis_status: hasStructure ? "ready" : "needs_input",
      analyzed_at: new Date().toISOString(),
      metadata: {
        skills: input.extracted.skills,
        experienceRequirements: input.extracted.experienceRequirements,
        eligibilityCriteria: input.extracted.eligibilityCriteria,
        importantDates: input.extracted.importantDates,
      },
    })
    .eq("id", input.opportunityId);

  if (deadlineAt) {
    await input.supabase.from("applications").update({ deadline_at: deadlineAt }).eq("id", input.applicationId);
  }

  await input.supabase.from("requirements").delete().eq("opportunity_id", input.opportunityId);
  await input.supabase.from("opportunity_questions").delete().eq("opportunity_id", input.opportunityId);
  await input.supabase.from("opportunity_documents").delete().eq("opportunity_id", input.opportunityId);
  await input.supabase.from("application_questions").delete().eq("application_id", input.applicationId);

  if (requirementRows.length > 0) {
    await input.supabase.from("requirements").insert(
      requirementRows.map((item) => ({
        user_id: input.userId,
        opportunity_id: input.opportunityId,
        text: item.text.slice(0, 500),
        hard: item.hard,
        kind: item.kind,
        confidence: input.source === "manual" ? 1 : 0.6,
        source_span: item.sourceSpan ?? input.source,
      })),
    );
  }

  if (input.extracted.questions.length > 0) {
    const questionRows = input.extracted.questions.slice(0, 20).map((item, index) => ({
      user_id: input.userId,
      opportunity_id: input.opportunityId,
      prompt: item.prompt.slice(0, 1000),
      limit_value: item.limitValue,
      limit_unit: item.limitUnit,
      sort_order: index,
      source: input.source,
    }));
    await input.supabase.from("opportunity_questions").insert(questionRows);
    await input.supabase.from("application_questions").insert(
      questionRows.map((item, index) => ({
        user_id: input.userId,
        application_id: input.applicationId,
        prompt: item.prompt,
        limit_value: item.limit_value,
        limit_unit: item.limit_unit,
        sort_order: index,
        source: input.source,
      })),
    );
  }

  if (input.extracted.requiredDocuments.length > 0) {
    await input.supabase.from("opportunity_documents").insert(
      input.extracted.requiredDocuments.slice(0, 20).map((item) => ({
        user_id: input.userId,
        opportunity_id: input.opportunityId,
        label: item.label.slice(0, 180),
        required: item.required,
      })),
    );
  }
}

export async function markOpportunityAnalysisFailed(
  supabase: SupabaseClient,
  opportunityId: string,
  reason: string,
) {
  await supabase
    .from("opportunities")
    .update({
      analysis_status: "failed",
      metadata: { analysisError: reason.slice(0, 240) },
    })
    .eq("id", opportunityId);
}

export async function ensureApplication(
  supabase: SupabaseClient,
  userId: string,
  opportunityId: string,
  deadlineAt: string | null,
): Promise<string> {
  const { data: existing } = await supabase
    .from("applications")
    .select("id")
    .eq("opportunity_id", opportunityId)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: created, error } = await supabase
    .from("applications")
    .insert({
      user_id: userId,
      opportunity_id: opportunityId,
      status: "draft",
      deadline_at: deadlineAt,
      next_action: "Review analyzed requirements and verify eligibility",
    })
    .select("id")
    .single();

  if (error || !created) throw new Error("APPLICATION_CREATE_FAILED");
  return created.id as string;
}

export async function runOpportunityAnalysisJob(input: {
  supabase: SupabaseClient;
  actor: Actor;
  userId: string;
  opportunityId: string;
  applicationId: string;
  pageText: string;
  sourceUrl?: string;
  source: OpportunitySource;
}) {
  const extracted = await extractOpportunityFromText(input.pageText, input.sourceUrl);
  if (!extracted) {
    await input.supabase
      .from("opportunities")
      .update({ analysis_status: "needs_input" })
      .eq("id", input.opportunityId);
    return { status: "needs_input" as const };
  }

  await persistOpportunityAnalysis({
    supabase: input.supabase,
    userId: input.userId,
    opportunityId: input.opportunityId,
    applicationId: input.applicationId,
    extracted,
    source: input.source,
  });
  return { status: "ready" as const };
}
