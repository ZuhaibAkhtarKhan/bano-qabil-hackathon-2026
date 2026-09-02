import { fieldSignals, isJudgmentYesNoQuestion, mapField, type DetectedField, type MemoryValue } from "@1apply/form-engine";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { logError, logInfo } from "@/lib/log";
import { detectProfileMemoryField, isNeedsYouSystemNoise, isStructuredFormFieldPrompt } from "@/lib/needs-you";
import { autoAttachKitAcrossOpenApplications } from "@/server/applications/attach-kit";
import {
  resolveKitValuesWithAi,
  type KitResolvedValue,
} from "@/server/applications/resolve-kit-value-ai";
import { loadMemoryCatalog } from "@/server/extension/memory-catalog";
import { evaluateApplicationIntelligence } from "@/server/intelligence/evaluate";

const CLOSED = new Set(["submitted", "rejected", "withdrawn", "archived", "offer", "accepted"]);
const FILL_CONFIDENCE = 0.75;

const PROFILE_CATALOG_PATH: Record<string, string> = {
  display_name: "Profile → Full name",
  phone: "Profile → Phone",
  location_city: "Profile → Location",
  location_country: "Profile → Location",
  work_authorization: "Profile → Work authorization",
  linkedin_url: "Profile → LinkedIn",
  github_url: "Profile → GitHub",
  portfolio_url: "Profile → Portfolio",
};

function labelToDetectedField(label: string, key = "needs-you"): DetectedField {
  const trimmed = label.trim() || key;
  const field: Omit<DetectedField, "signals"> & { signals?: string } = {
    key,
    name: key,
    id: key,
    label: trimmed,
    placeholder: "",
    ariaLabel: trimmed,
    nearbyText: trimmed,
    type: "text",
    inputType: "text",
    options: [],
    required: false,
    autocomplete: "",
  };
  return {
    ...field,
    signals: fieldSignals(field),
  };
}

function mappingToDetectedField(row: {
  field_key: string;
  label: string | null;
}): DetectedField {
  return labelToDetectedField(String(row.label ?? "").trim() || String(row.field_key), String(row.field_key));
}

function catalogValueForProfileField(catalog: MemoryValue[], field: string): string {
  const path = PROFILE_CATALOG_PATH[field];
  if (!path) return "";
  const exact = catalog.find((item) => item.path === path && item.value.trim());
  if (exact) return exact.value.trim();
  if (field === "location_city" || field === "location_country") {
    const loc = catalog.find((item) => item.path === "Profile → Location" && item.value.trim());
    return loc?.value.trim() ?? "";
  }
  return "";
}

function educationFromCatalog(catalog: MemoryValue[]): string {
  const preferredPaths = ["Education → Institution", "Education → Detail", "Education → Course"];
  for (const path of preferredPaths) {
    const hit = catalog.find((item) => item.path === path && item.value.trim());
    if (hit) return hit.value.trim();
  }
  return "";
}

/** Deterministic resolve (aliases / profile heuristics / mapField). */
export function resolveKitValueForLabel(label: string, catalog: MemoryValue[]): KitResolvedValue | null {
  const text = label.trim();
  if (!text || isNeedsYouSystemNoise(text)) return null;

  // Commitment / status Yes/No must never be filled by fuzzy kit / university heuristics.
  if (isJudgmentYesNoQuestion(text)) return null;

  // Asking "are you a university student?" is not asking for the school name.
  const asksInstitutionName =
    /\b(uni|university|college|campus|school|institute)\b/i.test(text) &&
    !/\b(are you|student|enrolled|attend|attending|currently)\b/i.test(text);
  if (asksInstitutionName) {
    const education = educationFromCatalog(catalog);
    if (education) return { value: education, confidence: 0.9, source: "Your kit" };
  }

  const profileField = detectProfileMemoryField(text);
  if (profileField && profileField !== "date_of_birth") {
    const fromProfile = catalogValueForProfileField(catalog, profileField);
    if (fromProfile) {
      return { value: fromProfile, confidence: 0.95, source: "Your kit" };
    }
  }

  const mapped = mapField(labelToDetectedField(text), catalog);
  const proposed = String(mapped.proposedValue ?? "").trim();
  if (!proposed) return null;
  if (mapped.sensitive) return null;
  if (mapped.confidence < FILL_CONFIDENCE) return null;
  if (mapped.excludedByDefault && !/^(Profile|Education|Skills) →/.test(mapped.memoryPath)) {
    return null;
  }
  // Never accept bare Yes/No from text-field mapping fallthrough.
  if (/^(yes|y|no|n)$/i.test(proposed)) return null;
  return {
    value: proposed,
    confidence: mapped.confidence,
    source: mapped.source || "Your kit",
  };
}

/**
 * When Your kit changes, rematch open applications:
 * - attach matching documents
 * - fill empty / low-confidence field_mappings from the updated memory catalog
 * - fill / clear Needs You answer gaps (missing_facts + short profile questions)
 * - LLM semantic fallback when wording differs (Contact No ≈ phone, Uni ≈ university)
 * - always re-run Fit Index so Fit gaps stay in sync
 */
export async function refreshOpenApplicationsFromKit(
  supabase: SupabaseClient,
  actor: Actor,
): Promise<{ appsTouched: number; mappingsFilled: number; docsAttached: number }> {
  const docsAttached = await autoAttachKitAcrossOpenApplications(supabase, actor);

  const { data: applications } = await supabase
    .from("applications")
    .select("id, opportunity_id, status")
    .eq("user_id", actor.userId)
    .limit(40);

  let appsTouched = 0;
  let mappingsFilled = 0;
  const appsToEvaluate: Array<{ applicationId: string; opportunityId: string }> = [];
  const seenApps = new Set<string>();

  for (const application of applications ?? []) {
    if (CLOSED.has(String(application.status))) continue;
    const applicationId = String(application.id);
    const opportunityId = String(application.opportunity_id);

    if (!seenApps.has(applicationId)) {
      seenApps.add(applicationId);
      appsToEvaluate.push({ applicationId, opportunityId });
    }

    const catalog = await loadMemoryCatalog(supabase, actor, applicationId);
    if (catalog.length === 0) continue;

    let filledHere = 0;
    const aiQueue: Array<{ id: string; label: string }> = [];
    const aiSeen = new Set<string>();
    const queueAi = (id: string, label: string) => {
      const text = label.trim();
      if (!text || isNeedsYouSystemNoise(text) || aiSeen.has(id)) return;
      aiSeen.add(id);
      aiQueue.push({ id, label: text });
    };

    const { data: mappings } = await supabase
      .from("field_mappings")
      .select("id, field_key, label, value, confidence, excluded_by_default, source")
      .eq("user_id", actor.userId)
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(120);

    // Clear unsafe Yes/No autofills (e.g. "No" from "Technology" substring match).
    for (const row of mappings ?? []) {
      const label = String(row.label ?? "").trim();
      const value = String(row.value ?? "").trim();
      if (!label || !value) continue;
      if (!isJudgmentYesNoQuestion(label)) continue;
      if (!/^(yes|y|no|n)$/i.test(value)) continue;
      await supabase
        .from("field_mappings")
        .update({
          value: "",
          confidence: 0.2,
          excluded_by_default: true,
          source: "Needs You",
        })
        .eq("id", row.id)
        .eq("user_id", actor.userId);
      row.value = "";
      row.confidence = 0.2;
      row.excluded_by_default = true;
    }

    const pending = (mappings ?? []).filter((row) => {
      const value = String(row.value ?? "").trim();
      return !value || Number(row.confidence ?? 0) < FILL_CONFIDENCE || Boolean(row.excluded_by_default);
    });

    type MappingPlan = {
      row: (typeof pending)[number];
      label: string;
      resolved: KitResolvedValue | null;
    };
    const mappingPlans: MappingPlan[] = [];
    const seenKeys = new Set<string>();

    for (const row of pending) {
      const fieldKey = String(row.field_key);
      if (seenKeys.has(fieldKey)) continue;
      seenKeys.add(fieldKey);

      const label = String(row.label ?? "").trim() || fieldKey;
      // Judgment Yes/No stays empty for Need You (fill-plan LLM may answer with evidence).
      if (isJudgmentYesNoQuestion(label)) {
        mappingPlans.push({ row, label, resolved: null });
        continue;
      }

      let resolved = resolveKitValueForLabel(label, catalog);
      if (!resolved) {
        const mapped = mapField(mappingToDetectedField(row), catalog);
        const proposed = String(mapped.proposedValue ?? "").trim();
        if (
          proposed &&
          !/^(yes|y|no|n)$/i.test(proposed) &&
          mapped.confidence >= FILL_CONFIDENCE &&
          (!mapped.excludedByDefault || /^(Profile|Education|Skills) →/.test(mapped.memoryPath))
        ) {
          resolved = { value: proposed, confidence: mapped.confidence, source: mapped.source };
        }
      }
      if (!resolved) queueAi(`mapping:${row.id}`, label);
      mappingPlans.push({ row, label, resolved });
    }

    const [{ data: answers }, { data: questions }] = await Promise.all([
      supabase
        .from("application_answers")
        .select("id, question_id, state, missing_facts, approved_text, user_edited_text")
        .eq("user_id", actor.userId)
        .eq("application_id", applicationId),
      supabase
        .from("opportunity_questions")
        .select("id, prompt")
        .eq("opportunity_id", opportunityId)
        .eq("user_id", actor.userId),
    ]);

    const answerByQuestionId = new Map(
      (answers ?? []).map((answer) => [String(answer.question_id), answer] as const),
    );

    type AnswerPlan = {
      answer: NonNullable<typeof answers>[number] | null;
      questionId: string;
      prompt: string;
      missing: string[];
      resolved: KitResolvedValue | null;
      isNew: boolean;
    };
    const answerPlans: AnswerPlan[] = [];

    for (const question of questions ?? []) {
      const questionId = String(question.id);
      const prompt = String(question.prompt ?? "").trim();
      if (!prompt || isNeedsYouSystemNoise(prompt)) continue;

      const answer = answerByQuestionId.get(questionId) ?? null;
      const missing = answer && Array.isArray(answer.missing_facts)
        ? (answer.missing_facts as string[]).filter(Boolean)
        : [];
      const existingText = answer
        ? String(answer.approved_text || answer.user_edited_text || "").trim()
        : "";
      const state = answer ? String(answer.state ?? "") : "";
      const needsFill =
        !answer ||
        !existingText ||
        ["needs_review", "rejected", "ai_generated"].includes(state) ||
        missing.length > 0;
      if (!needsFill) continue;

      const resolvedFromPrompt = resolveKitValueForLabel(prompt, catalog);
      const resolvedFromMissing = missing
        .map((fact) => resolveKitValueForLabel(fact, catalog))
        .find((item) => item?.value);
      const resolved = resolvedFromPrompt ?? resolvedFromMissing ?? null;

      // Structured contact fields: only queue AI when kit miss; essays always try AI fallback.
      if (!resolved) {
        if (!isStructuredFormFieldPrompt(prompt) || missing.length > 0) {
          queueAi(`answer:${questionId}:prompt`, prompt);
        }
        for (const fact of missing) {
          if (!resolveKitValueForLabel(fact, catalog) && !isNeedsYouSystemNoise(fact)) {
            queueAi(`answer:${questionId}:fact:${fact.slice(0, 80)}`, fact);
          }
        }
      }

      answerPlans.push({
        answer,
        questionId,
        prompt,
        missing,
        resolved,
        isNew: !answer,
      });
    }

    const aiMatches = await resolveKitValuesWithAi(aiQueue, catalog);

    for (const plan of mappingPlans) {
      const resolved = plan.resolved ?? aiMatches.get(`mapping:${plan.row.id}`) ?? null;
      if (!resolved) continue;

      const existing = String(plan.row.value ?? "").trim();
      if (existing && Number(plan.row.confidence ?? 0) >= resolved.confidence) continue;

      const { error } = await supabase
        .from("field_mappings")
        .update({
          value: resolved.value.slice(0, 4000),
          source: `Your kit refresh · ${resolved.source}`.slice(0, 120),
          confidence: resolved.confidence,
          excluded_by_default: false,
          label: plan.label.slice(0, 180),
        })
        .eq("id", plan.row.id)
        .eq("user_id", actor.userId);

      if (error) {
        logError("needs_you.kit_refresh_mapping_failed", {
          applicationId,
          fieldKey: plan.row.field_key,
          message: error.message,
        });
        continue;
      }
      filledHere += 1;
    }

    for (const plan of answerPlans) {
      const fromAiPrompt = aiMatches.get(`answer:${plan.questionId}:prompt`) ?? null;
      const fromAiFact = plan.missing
        .map((fact) => aiMatches.get(`answer:${plan.questionId}:fact:${fact.slice(0, 80)}`))
        .find((item) => item?.value);
      const resolved = plan.resolved ?? fromAiPrompt ?? fromAiFact ?? null;

      const remaining = plan.missing.filter((fact) => {
        if (isNeedsYouSystemNoise(fact)) return false;
        if (resolveKitValueForLabel(fact, catalog)?.value) return false;
        const aiHit = aiMatches.get(`answer:${plan.questionId}:fact:${fact.slice(0, 80)}`);
        return !aiHit?.value;
      });

      const canAutoApprove = Boolean(resolved?.value) && remaining.length === 0;
      if (!canAutoApprove || !resolved) {
        if (plan.answer && remaining.length !== plan.missing.length) {
          const { error } = await supabase
            .from("application_answers")
            .update({ missing_facts: remaining })
            .eq("id", plan.answer.id)
            .eq("user_id", actor.userId);
          if (error) {
            logError("needs_you.kit_refresh_missing_facts_failed", {
              applicationId,
              answerId: plan.answer.id,
              message: error.message,
            });
            continue;
          }
          filledHere += plan.missing.length - remaining.length;
        }
        continue;
      }

      if (plan.isNew || !plan.answer) {
        const { error } = await supabase.from("application_answers").insert({
          user_id: actor.userId,
          application_id: applicationId,
          question_id: plan.questionId,
          approved_text: resolved.value.slice(0, 8000),
          user_edited_text: resolved.value.slice(0, 8000),
          original_ai_text: resolved.value.slice(0, 8000),
          state: "approved",
          missing_facts: [],
          warnings: [],
          evidence_ids: [],
          claim_flags: [],
          grounding_score: resolved.confidence,
          generation_count: 0,
          model: "kit-refresh",
        });
        if (error) {
          logError("needs_you.kit_refresh_answer_insert_failed", {
            applicationId,
            questionId: plan.questionId,
            message: error.message,
          });
          continue;
        }
        filledHere += 1;
        continue;
      }

      const { error } = await supabase
        .from("application_answers")
        .update({
          approved_text: resolved.value.slice(0, 8000),
          user_edited_text: resolved.value.slice(0, 8000),
          state: "approved",
          missing_facts: [],
          warnings: [],
        })
        .eq("id", plan.answer.id)
        .eq("user_id", actor.userId);
      if (error) {
        logError("needs_you.kit_refresh_answer_failed", {
          applicationId,
          answerId: plan.answer.id,
          message: error.message,
        });
        continue;
      }
      filledHere += 1;
    }

    if (filledHere > 0) {
      appsTouched += 1;
      mappingsFilled += filledHere;
    }
  }

  for (const app of appsToEvaluate.slice(0, 12)) {
    try {
      await evaluateApplicationIntelligence(supabase, actor, app.applicationId, app.opportunityId);
    } catch (error) {
      logError("needs_you.kit_refresh_eval_failed", {
        applicationId: app.applicationId,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  logInfo("needs_you.kit_refresh_done", {
    userId: actor.userId,
    appsTouched,
    mappingsFilled,
    docsAttached,
    appsEvaluated: Math.min(appsToEvaluate.length, 12),
  });

  return { appsTouched, mappingsFilled, docsAttached };
}

const KIT_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const lastKitRefreshByUser = new Map<string, number>();

/** Fire-and-forget so kit saves stay snappy; errors are logged only. */
export function scheduleRefreshOpenApplicationsFromKit(supabase: SupabaseClient, actor: Actor) {
  const now = Date.now();
  const last = lastKitRefreshByUser.get(actor.userId) ?? 0;
  if (now - last < KIT_REFRESH_COOLDOWN_MS) return;
  lastKitRefreshByUser.set(actor.userId, now);

  void refreshOpenApplicationsFromKit(supabase, actor).catch((error) => {
    logError("needs_you.kit_refresh_failed", {
      userId: actor.userId,
      message: error instanceof Error ? error.message : "unknown",
    });
  });
}
