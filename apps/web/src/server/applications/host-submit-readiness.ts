import { packetAnswerText, requiredDocumentCovered } from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { isNeedsYouSystemNoise, isStructuredFormFieldPrompt } from "@/lib/needs-you";
import { normalizeNeedsYouFieldType } from "@/lib/needs-you-field-kinds";
import { dedupeFieldMappingsByKey } from "@/lib/field-mappings";

const CLOSED_STATUSES = new Set(["submitted", "rejected", "withdrawn", "archived", "offer"]);

const BLOCKING_ELIGIBILITY = new Set(["unclear", "not_met", "partial", "needs_confirmation"]);

export type HostSubmitReadiness = {
  ready: boolean;
  reason?: string;
  openCount?: number;
};

/** True when every host form field is filled (required + optional). Deadline Need You is ignored. */
export async function assessNoDeadlineHostSubmitReadiness(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
}): Promise<HostSubmitReadiness> {
  const { supabase, actor, applicationId } = input;

  const { data: application } = await supabase
    .from("applications")
    .select("id, status, deadline_at, opportunity_id")
    .eq("id", applicationId)
    .eq("user_id", actor.userId)
    .maybeSingle();

  if (!application) return { ready: false, reason: "not_found" };
  if (CLOSED_STATUSES.has(String(application.status))) return { ready: false, reason: "closed" };
  if (application.deadline_at) return { ready: false, reason: "has_deadline" };

  const opportunityId = String(application.opportunity_id);

  const [
    { data: mappings },
    { data: questions },
    { data: answers },
    { data: requiredDocs },
    { data: attached },
    { data: vaultDocs },
    { data: eligibility },
    { data: fit },
  ] = await Promise.all([
    supabase
      .from("field_mappings")
      .select("id, label, field_key, value, confidence, excluded_by_default, field_type, meta")
      .eq("application_id", applicationId)
      .eq("user_id", actor.userId),
    supabase.from("opportunity_questions").select("id, prompt, required").eq("opportunity_id", opportunityId),
    supabase
      .from("application_answers")
      .select("question_id, state, approved_text, original_ai_text, user_edited_text")
      .eq("application_id", applicationId),
    supabase.from("opportunity_documents").select("label, required").eq("opportunity_id", opportunityId),
    supabase.from("application_documents").select("document_id").eq("application_id", applicationId),
    supabase.from("documents").select("id, type, label").eq("user_id", actor.userId),
    supabase
      .from("eligibility_results")
      .select("state, user_confirmed_at")
      .eq("application_id", applicationId)
      .eq("user_id", actor.userId),
    supabase.from("fit_evaluations").select("missing").eq("application_id", applicationId).maybeSingle(),
  ]);

  let openCount = 0;

  // Prefer filled Need You / memory rows over empty page_capture duplicates.
  const uniqueMappings = dedupeFieldMappingsByKey(mappings ?? []);

  for (const mapping of uniqueMappings) {
    const value = String(mapping.value ?? "").trim();
    const confidence = Number(mapping.confidence ?? 0);
    if (!value || confidence < 0.75 || Boolean(mapping.excluded_by_default)) {
      openCount += 1;
    }
  }

  const answerByQuestion = new Map((answers ?? []).map((row) => [String(row.question_id), row]));
  for (const question of questions ?? []) {
    const prompt = String(question.prompt ?? "");
    if (isStructuredFormFieldPrompt(prompt)) continue;
    const answer = answerByQuestion.get(String(question.id));
    const approved =
      Boolean(answer?.approved_text) ||
      String(answer?.state ?? "") === "approved" ||
      Boolean(
        packetAnswerText({
          approvedText: (answer?.approved_text as string | null) ?? null,
          userEditedText: (answer?.user_edited_text as string | null) ?? null,
          originalAiText: (answer?.original_ai_text as string | null) ?? null,
        }),
      );
    if (!approved) openCount += 1;
  }

  const attachedIds = new Set((attached ?? []).map((row) => String(row.document_id)));
  const attachedVault = (vaultDocs ?? [])
    .filter((row) => attachedIds.has(String(row.id)))
    .map((row) => ({ type: String(row.type), label: String(row.label) }));

  for (const doc of requiredDocs ?? []) {
    if (!requiredDocumentCovered(String(doc.label), attachedVault)) {
      openCount += 1;
    }
  }

  for (const row of eligibility ?? []) {
    if (row.user_confirmed_at) continue;
    if (BLOCKING_ELIGIBILITY.has(String(row.state ?? ""))) {
      openCount += 1;
    }
  }

  const fitMissing = Array.isArray(fit?.missing) ? (fit?.missing as string[]) : [];
  for (const gap of fitMissing) {
    if (gap && !isNeedsYouSystemNoise(gap)) {
      openCount += 1;
    }
  }

  for (const mapping of uniqueMappings) {
    const fieldType = normalizeNeedsYouFieldType(
      typeof mapping.field_type === "string" ? mapping.field_type : null,
    );
    if (fieldType !== "file") continue;
    const label = String(mapping.label ?? "").trim();
    const value = String(mapping.value ?? "").trim();
    if (value) continue;
    if (label && requiredDocumentCovered(label, attachedVault)) continue;
    openCount += 1;
  }

  if (openCount > 0) {
    return { ready: false, reason: "open_needs_you", openCount };
  }

  return { ready: true };
}
