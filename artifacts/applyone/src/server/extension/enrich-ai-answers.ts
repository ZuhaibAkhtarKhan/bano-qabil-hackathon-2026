import type { FieldMapping } from "@1apply/form-engine";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { tryGetAiProvider } from "@/infra/ai/openai";
import { logError } from "@/lib/log";

async function loadDraftContext(supabase: SupabaseClient, actor: Actor, applicationId: string) {
  const [{ data: profile }, { data: facts }, { data: evidence }, { data: answers }, { data: application }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, headline, location_city, location_country, linkedin_url, github_url, portfolio_url")
      .eq("id", actor.userId)
      .maybeSingle(),
    supabase.from("profile_facts").select("category, value, verification_status").eq("user_id", actor.userId).limit(40),
    supabase
      .from("evidence_items")
      .select("title, organization, outcome, skills, situation, action, verification_status, excluded_from_ai, kind")
      .eq("user_id", actor.userId)
      .limit(24),
    supabase
      .from("application_answers")
      .select("question_id, approved_text, original_ai_text, user_edited_text")
      .eq("application_id", applicationId)
      .eq("user_id", actor.userId),
    supabase.from("applications").select("opportunity_id").eq("id", applicationId).eq("user_id", actor.userId).maybeSingle(),
  ]);

  let opportunityLine = "";
  let questionPrompts: Array<{ id: string; prompt: string }> = [];
  if (application?.opportunity_id) {
    const [{ data: opportunity }, { data: questions }] = await Promise.all([
      supabase
        .from("opportunities")
        .select("title, organization, category, raw_excerpt")
        .eq("id", application.opportunity_id)
        .maybeSingle(),
      supabase.from("opportunity_questions").select("id, prompt").eq("opportunity_id", application.opportunity_id),
    ]);
    opportunityLine = [opportunity?.title, opportunity?.organization, opportunity?.category, opportunity?.raw_excerpt?.slice(0, 800)]
      .filter(Boolean)
      .join(" | ");
    questionPrompts = (questions ?? []) as Array<{ id: string; prompt: string }>;
  }

  const promptById = new Map(questionPrompts.map((item) => [item.id, item.prompt]));
  const priorAnswers = (answers ?? [])
    .map((row) => {
      const text = (row.approved_text || row.user_edited_text || row.original_ai_text || "").trim();
      if (!text) return null;
      return {
        question: promptById.get(row.question_id as string) ?? "Prior application answer",
        answer: text.slice(0, 1200),
      };
    })
    .filter(Boolean);

  const factLines = (facts ?? [])
    .filter((row) => row.verification_status === "verified" || row.verification_status === "unverified")
    .slice(0, 20)
    .map((row) => {
      const value = typeof row.value === "string" ? row.value : JSON.stringify(row.value);
      return `${row.category}: ${value}`.slice(0, 240);
    });

  const evidenceLines = (evidence ?? [])
    .filter((row) => !row.excluded_from_ai)
    .slice(0, 12)
    .map((row) =>
      [
        row.kind,
        row.title,
        row.organization,
        row.situation,
        row.action,
        row.outcome,
        Array.isArray(row.skills) ? row.skills.join(", ") : "",
      ]
        .filter(Boolean)
        .join(" — "),
    )
    .filter(Boolean);

  return {
    profileLine: [
      profile?.display_name,
      profile?.headline,
      profile?.location_city,
      profile?.location_country,
      profile?.linkedin_url,
      profile?.github_url,
      profile?.portfolio_url,
    ]
      .filter(Boolean)
      .join(" · "),
    opportunityLine,
    factLines,
    evidenceLines,
    priorAnswers,
  };
}

/** On-demand grounded draft for one open-ended form question. */
export async function generateGroundedAiDraft(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  question: string;
  guidance?: string;
  limitValue?: number | null;
  limitUnit?: "words" | "characters" | null;
}): Promise<{ draft: string; grounded: boolean; limitApplied: boolean }> {
  const provider = tryGetAiProvider();
  if (!provider) {
    throw new Error("AI_UNAVAILABLE");
  }

  const context = await loadDraftContext(input.supabase, input.actor, input.applicationId);
  const hasMemory = Boolean(
    context.profileLine || context.factLines.length || context.evidenceLines.length || context.priorAnswers.length,
  );

  const limitValue = input.limitValue && input.limitValue > 0 ? Math.floor(input.limitValue) : null;
  const limitUnit = input.limitUnit === "words" || input.limitUnit === "characters" ? input.limitUnit : null;
  const guidance = input.guidance?.trim().slice(0, 1000) || "";

  const lengthRule = limitValue && limitUnit
    ? `Hard length limit: at most ${limitValue} ${limitUnit}. Do not exceed this. Prefer staying slightly under the limit.`
    : "Prefer 80–160 words unless the question clearly wants shorter.";

  const guidanceRule = guidance
    ? `The applicant also asked you to incorporate this guidance (still only using facts from Application Memory; do not invent): ${guidance}`
    : "";

  try {
    const text = await provider.generateText({
      instruction: [
        "You draft application-form answers using ONLY the provided Application Memory.",
        "Ground every claim in profile, verified/unverified facts, evidence (experience/projects), or prior answers.",
        "Do not invent employers, degrees, dates, awards, metrics, or skills that are absent from memory.",
        "If memory is thin for this question, write a short honest draft that only uses what exists and notes what is missing in one clause.",
        "Return plain text only — no markdown headings, no preamble like 'Sure'.",
        lengthRule,
        guidanceRule,
        "Tone: professional, concrete, first person.",
      ]
        .filter(Boolean)
        .join(" "),
      untrustedData: JSON.stringify({
        question: input.question.slice(0, 2000),
        applicantGuidance: guidance || null,
        lengthLimit: limitValue && limitUnit ? { value: limitValue, unit: limitUnit } : null,
        profile: context.profileLine,
        opportunity: context.opportunityLine,
        facts: context.factLines,
        evidence: context.evidenceLines,
        priorAnswers: context.priorAnswers,
      }),
    });
    let cleaned = text.replace(/^["'\s]+|["'\s]+$/g, "").trim();
    if (!cleaned) throw new Error("EMPTY_DRAFT");

    let limitApplied = false;
    if (limitValue && limitUnit === "words") {
      const words = cleaned.split(/\s+/);
      if (words.length > limitValue) {
        cleaned = words.slice(0, limitValue).join(" ");
        limitApplied = true;
      }
    } else if (limitValue && limitUnit === "characters" && cleaned.length > limitValue) {
      cleaned = cleaned.slice(0, limitValue).trimEnd();
      limitApplied = true;
    }

    return { draft: cleaned.slice(0, 4000), grounded: hasMemory, limitApplied };
  } catch (error) {
    logError("extension.ai_draft_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  }
}

/**
 * Fill-plan enrichment no longer eagerly generates AI text.
 * Open questions get a Grammarly-style assistant in the extension; drafts are on-demand.
 */
export async function enrichAiAnswerableMappings(
  _supabase: SupabaseClient,
  _actor: Actor,
  _applicationId: string,
  mappings: FieldMapping[],
): Promise<FieldMapping[]> {
  return mappings.map((mapping) => {
    if (!mapping.aiAnswerable || mapping.sensitive || mapping.approvalState === "blocked") return mapping;
    return {
      ...mapping,
      proposedValue: "",
      showChip: true,
      reason: "Open-ended question — open the 1-Apply assistant to draft from Application Memory, then Confirm to fill.",
    };
  });
}
