"use server";

import {
  buildAnswerPrompt,
  classifyQuestion,
  finalizeGroundedDraft,
  groundingScore,
  lengthWarnings,
  rankEvidenceForAnswer,
  validateClaims,
  type GenerationIntent,
  type ToneStyle,
} from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@/auth/actor";
import { getAiProvider, groundedDraftModelSchema } from "@/infra/ai/openai";
import { logError } from "@/lib/log";
import { mapEvidence } from "@/server/memory/map-evidence";
import type { EvidenceRow } from "@/server/types";

const PROMPT_VERSION = "p9.1";

// ─── Load context ─────────────────────────────────────────────────────────────

async function loadAnswerContext(
  supabase: SupabaseClient,
  actor: Actor,
  applicationId: string,
  questionId: string,
) {
  const [{ data: evidenceRows }, { data: question }, { data: application }] = await Promise.all([
    supabase
      .from("evidence_items")
      .select(
        "id, title, kind, organization, situation, action, outcome, skills, verification_status, excluded_from_ai, start_date, end_date",
      )
      .eq("user_id", actor.userId),
    supabase
      .from("opportunity_questions")
      .select("id, prompt, limit_value, limit_unit, required, opportunity_id")
      .eq("id", questionId)
      .maybeSingle(),
    supabase
      .from("applications")
      .select("id, opportunity_id")
      .eq("id", applicationId)
      .eq("user_id", actor.userId)
      .maybeSingle(),
  ]);

  if (!application) throw new Error("APPLICATION_NOT_FOUND");
  if (!question) throw new Error("QUESTION_NOT_FOUND");

  const { data: opportunity } = await supabase
    .from("opportunities")
    .select("title, organization, location, category, raw_excerpt")
    .eq("id", application.opportunity_id as string)
    .maybeSingle();

  const evidence = ((evidenceRows ?? []) as EvidenceRow[]).map(mapEvidence);
  const opportunityContext = [
    opportunity?.title,
    opportunity?.organization,
    opportunity?.location,
    opportunity?.category,
    opportunity?.raw_excerpt,
  ]
    .filter(Boolean)
    .join(" ");

  return { evidence, question, opportunityContext };
}

// ─── Persist answer ───────────────────────────────────────────────────────────

async function persistAnswer(
  supabase: SupabaseClient,
  actor: Actor,
  input: {
    applicationId: string;
    questionId: string;
    text: string;
    state: string;
    evidenceIds: string[];
    claimFlags: ReturnType<typeof validateClaims>;
    missingFacts: string[];
    warnings: string[];
    gScore: number;
    model: string;
    prevAnswerId?: string | null;
    prevGenerationCount?: number;
  },
) {
  const {
    applicationId, questionId, text, state, evidenceIds,
    claimFlags, missingFacts, warnings, gScore, model,
    prevAnswerId, prevGenerationCount = 0,
  } = input;

  const genCount = prevGenerationCount + 1;

  if (prevAnswerId) {
    // Save current text as a version before overwriting
    const { data: existing } = await supabase
      .from("application_answers")
      .select("original_ai_text, user_edited_text, state, evidence_ids, claim_flags, grounding_score, model, version_number")
      .eq("id", prevAnswerId)
      .maybeSingle();

    if (existing) {
      const versionText =
        (existing.user_edited_text as string | null) ??
        (existing.original_ai_text as string | null) ??
        "";
      if (versionText) {
        await supabase.from("answer_versions").insert({
          answer_id: prevAnswerId,
          user_id: actor.userId,
          application_id: applicationId,
          question_id: questionId,
          version_number: (existing.version_number as number | null) ?? 1,
          text: versionText,
          state: existing.state as string,
          evidence_ids: (existing.evidence_ids as string[]) ?? [],
          claim_flags: (existing.claim_flags as object[]) ?? [],
          grounding_score: (existing.grounding_score as number) ?? 0,
          model: existing.model as string | null,
          prompt_version: PROMPT_VERSION,
        });
      }
    }

    await supabase
      .from("application_answers")
      .update({
        state,
        original_ai_text: text,
        user_edited_text: null,
        approved_text: null,
        evidence_ids: evidenceIds,
        claim_flags: claimFlags,
        missing_facts: missingFacts,
        warnings,
        grounding_score: gScore,
        model,
        prompt_version: PROMPT_VERSION,
        generation_count: genCount,
        version_number: prevGenerationCount + 2,
      })
      .eq("id", prevAnswerId);

    return prevAnswerId;
  }

  const { data: inserted, error } = await supabase
    .from("application_answers")
    .insert({
      application_id: applicationId,
      question_id: questionId,
      user_id: actor.userId,
      state,
      original_ai_text: text,
      user_edited_text: null,
      approved_text: null,
      evidence_ids: evidenceIds,
      claim_flags: claimFlags,
      missing_facts: missingFacts,
      warnings,
      grounding_score: gScore,
      model,
      prompt_version: PROMPT_VERSION,
      generation_count: genCount,
    })
    .select("id")
    .single();

  if (error || !inserted) throw new Error("ANSWER_INSERT_FAILED");
  return inserted.id as string;
}

// ─── Main generate function ───────────────────────────────────────────────────

export async function generateAnswer(
  supabase: SupabaseClient,
  actor: Actor,
  input: {
    applicationId: string;
    questionId: string;
    intent: GenerationIntent;
    tone: ToneStyle;
    previousAnswerId?: string | null;
    previousAnswerText?: string | null;
    previousGenerationCount?: number;
  },
) {
  const { applicationId, questionId, intent, tone, previousAnswerId, previousAnswerText, previousGenerationCount } = input;

  const { evidence, question, opportunityContext } = await loadAnswerContext(
    supabase,
    actor,
    applicationId,
    questionId,
  );

  const kind = classifyQuestion(question.prompt as string);
  const ranked = rankEvidenceForAnswer(question.prompt as string, kind, evidence);

  // If no evidence at all → return INSUFFICIENT_EVIDENCE immediately
  if (ranked.length === 0) {
    return {
      answerId: await persistAnswer(supabase, actor, {
        applicationId,
        questionId,
        text: "",
        state: "needs_review",
        evidenceIds: [],
        claimFlags: [],
        missingFacts: ["No verified evidence found in Application Memory."],
        warnings: ["INSUFFICIENT_EVIDENCE"],
        gScore: 0,
        model: "none",
        prevAnswerId: previousAnswerId,
        prevGenerationCount: previousGenerationCount,
      }),
      text: "",
      evidenceIds: [],
      missingFacts: ["No verified evidence found in Application Memory."],
      warnings: ["INSUFFICIENT_EVIDENCE"],
      claimFlags: [],
      groundingScore: 0,
      state: "needs_review" as const,
    };
  }

  const { instruction, untrustedData } = buildAnswerPrompt({
    question: question.prompt as string,
    kind,
    opportunityContext,
    evidenceItems: ranked,
    intent,
    tone,
    limitValue: question.limit_value as number | null,
    limitUnit: question.limit_unit as string | null,
    previousAnswer: previousAnswerText,
  });

  let rawResult: unknown;
  const provider = getAiProvider();
  try {
    rawResult = await provider.generateStructured({
      schemaName: "grounded_draft",
      instruction,
      untrustedData,
    });
  } catch (err) {
    logError("answer.generate_failed", { questionId, err });
    throw new Error("AI_GENERATION_FAILED");
  }

  const parsed = groundedDraftModelSchema.safeParse(rawResult);
  if (!parsed.success) {
    throw new Error("AI_INVALID_RESPONSE");
  }

  const allowedIds = ranked.map((e) => e.id);
  const draft = finalizeGroundedDraft({
    text: parsed.data.text,
    citedIds: parsed.data.evidenceIds,
    allowedIds,
    missingFacts: parsed.data.missingFacts,
    warnings: parsed.data.warnings,
  });

  // Length validation
  const lenWarnings = lengthWarnings(
    draft.text,
    question.limit_value as number | null,
    question.limit_unit as string | null,
  );

  const allWarnings = [...new Set([...draft.warnings, ...lenWarnings])];

  // Claim validation
  const usedEvidence = ranked.filter((e) => draft.evidenceIds.includes(e.id));
  const claimFlags = validateClaims(draft.text, usedEvidence);
  const gScore = groundingScore(claimFlags);

  const hasInsufficient = draft.text.trim().length === 0 || allWarnings.includes("NO_EVIDENCE");
  const state = hasInsufficient
    ? "needs_review"
    : gScore < 0.6
      ? "needs_review"
      : "ai_generated";

  const answerId = await persistAnswer(supabase, actor, {
    applicationId,
    questionId,
    text: draft.text,
    state,
    evidenceIds: draft.evidenceIds,
    claimFlags,
    missingFacts: draft.missingFacts,
    warnings: allWarnings,
    gScore,
    model: provider.name,
    prevAnswerId: previousAnswerId,
    prevGenerationCount: previousGenerationCount,
  });

  return {
    answerId,
    text: draft.text,
    evidenceIds: draft.evidenceIds,
    missingFacts: draft.missingFacts,
    warnings: allWarnings,
    claimFlags,
    groundingScore: gScore,
    state,
  };
}
