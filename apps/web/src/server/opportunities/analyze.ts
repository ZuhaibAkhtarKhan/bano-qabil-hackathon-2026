import type { OpportunitySource } from "@1apply/contracts";
import { discoveryFiltersSchema, opportunityCategorySchema } from "@1apply/contracts";
import {
  classifyRequirementKind,
  mergeDiscoveryCriteria,
  parseDiscoveryCriteria,
} from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import type { Actor } from "@/auth/actor";
import {
  DISCOVERY_PARSE_INSTRUCTION,
  OPPORTUNITY_ANALYSIS_INSTRUCTION,
  wrapUntrustedPageContent,
} from "@/lib/opportunities/untrusted";
import { opportunityExtractionSchema, tryGetAiProvider } from "@/infra/ai/openai";
import { evaluateApplicationIntelligence } from "@/server/intelligence/evaluate";
import { autoAttachMatchingDocuments } from "@/server/applications/attach-kit";
import { scheduleRefreshOpenApplicationsFromKit } from "@/server/applications/refresh-from-kit";
import { draftSuggestedAnswersForApplication } from "@/server/answers/generate";
import { runOwnedJob } from "@/infra/jobs/runner";
import { isStructuredFormFieldPrompt } from "@/lib/needs-you";

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
      kind: classifyRequirementKind(item.text, item.kind),
      sourceSpan: item.sourceSpan ?? null,
    });
  }
  for (const text of extracted.eligibilityCriteria) {
    rows.push({ text, hard: true, kind: classifyRequirementKind(text, "eligibility"), sourceSpan: "eligibility" });
  }
  for (const text of extracted.skills) {
    rows.push({ text: `Skill: ${text}`, hard: false, kind: classifyRequirementKind(text, "skill"), sourceSpan: "skills" });
  }
  for (const text of extracted.experienceRequirements) {
    rows.push({ text, hard: false, kind: classifyRequirementKind(text, "experience"), sourceSpan: "experience" });
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
  const fallback = parseDiscoveryCriteria(query);
  const asFilters = () =>
    discoveryFiltersSchema.parse({
      categories: fallback.categories,
      locations: fallback.locations,
      remoteOk: fallback.remoteOk,
      educationLevel: fallback.educationLevel,
      experienceLevel: fallback.experienceLevel,
      domain: fallback.domain,
      skills: fallback.skills,
      otherConstraints: fallback.otherConstraints,
      keywords: fallback.keywords,
    });

  const provider = tryGetAiProvider();
  if (!provider) return asFilters();

  try {
    const raw = await provider.completeStructured({
      schemaName: "discoveryFilters",
      instruction: DISCOVERY_PARSE_INSTRUCTION,
      untrustedData: wrapUntrustedPageContent(query),
    });
    const parsed = discoveryFiltersSchema.safeParse(raw);
    if (!parsed.success) return asFilters();
    const merged = mergeDiscoveryCriteria(fallback, {
      categories: parsed.data.categories,
      locations: parsed.data.locations,
      remoteOk: parsed.data.remoteOk,
      educationLevel:
        parsed.data.educationLevel === "undergraduate" ||
        parsed.data.educationLevel === "graduate" ||
        parsed.data.educationLevel === "any"
          ? parsed.data.educationLevel
          : fallback.educationLevel,
      experienceLevel:
        parsed.data.experienceLevel === "internship" ||
        parsed.data.experienceLevel === "entry" ||
        parsed.data.experienceLevel === "mid" ||
        parsed.data.experienceLevel === "any"
          ? parsed.data.experienceLevel
          : fallback.experienceLevel,
      domain: parsed.data.domain,
      skills: parsed.data.skills,
      otherConstraints: parsed.data.otherConstraints,
      keywords: parsed.data.keywords,
    });
    return discoveryFiltersSchema.parse({
      categories: merged.categories,
      locations: merged.locations,
      remoteOk: merged.remoteOk,
      educationLevel: merged.educationLevel,
      experienceLevel: merged.experienceLevel,
      domain: merged.domain,
      skills: merged.skills,
      otherConstraints: merged.otherConstraints,
      keywords: merged.keywords,
    });
  } catch {
    return asFilters();
  }
}

export async function persistOpportunityAnalysis(input: {
  supabase: SupabaseClient;
  userId: string;
  opportunityId: string;
  applicationId: string;
  extracted: Extraction;
  source: OpportunitySource;
  actor?: Actor;
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
    const essayQuestions = input.extracted.questions
      .filter((item) => !isStructuredFormFieldPrompt(item.prompt))
      .slice(0, 20);
    if (essayQuestions.length > 0) {
      const questionRows = essayQuestions.map((item, index) => ({
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

  if (input.actor) {
    await autoAttachMatchingDocuments(input.supabase, input.actor, input.applicationId, input.opportunityId);
    try {
      await runOwnedJob(
        input.supabase,
        { actor: input.actor, type: "answer_draft", inputRef: input.applicationId },
        async () => {
          await draftSuggestedAnswersForApplication(
            input.supabase,
            input.actor!,
            input.applicationId,
            input.opportunityId,
          );
        },
      );
    } catch {
      // Suggestions are optional. Analysis still succeeds without them.
    }
    // Rematch Application Memory into answers / mappings after analysis.
    scheduleRefreshOpenApplicationsFromKit(input.supabase, input.actor);
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
      status: "saved",
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
    actor: input.actor,
  });
  await evaluateApplicationIntelligence(input.supabase, input.actor, input.applicationId, input.opportunityId);
  return { status: "ready" as const };
}
