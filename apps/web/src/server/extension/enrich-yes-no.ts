import { evaluateRequirement, type MemoryEvidence } from "@1apply/domain";
import { isJudgmentYesNoQuestion, type FieldMapping } from "@1apply/form-engine";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";

function isYesNoEligibilityMapping(mapping: FieldMapping): boolean {
  if (mapping.fieldType !== "radio" && mapping.fieldType !== "select") return false;
  if (mapping.sensitive || mapping.approvalState === "blocked") return false;
  if (isJudgmentYesNoQuestion(mapping.label)) return false;
  const options = mapping.options.map((item) => item.value.trim().toLowerCase());
  if (options.length !== 2) return false;
  const hasYes = options.some((item) => item === "yes" || item === "y");
  const hasNo = options.some((item) => item === "no" || item === "n");
  if (!hasYes || !hasNo) return false;
  // Degree / years / qualified — not open "are you currently…" status questions.
  return /\b(do you (have|possess|hold)|have you|bachelor|master|degree|years?.{0,40}experience|qualified|eligible|or equivalent|related field)\b/i.test(
    mapping.label,
  );
}

function pickYesNo(mapping: FieldMapping): { yes: string; no: string } | null {
  const yes = mapping.options.find((item) => /^(yes|y)$/i.test(item.value.trim()));
  const no = mapping.options.find((item) => /^(no|n)$/i.test(item.value.trim()));
  if (!yes || !no) return null;
  return { yes: yes.value, no: no.value };
}

async function loadEvidence(supabase: SupabaseClient, actor: Actor): Promise<{
  evidence: MemoryEvidence[];
  context: {
    locationCity?: string | null;
    locationCountry?: string | null;
    facts?: Array<{ id: string; category: string; value: string; verificationStatus: "unverified" | "verified" | "rejected" }>;
  };
}> {
  const [{ data: evidence }, { data: profile }, { data: facts }] = await Promise.all([
    supabase
      .from("evidence_items")
      .select("id, title, kind, organization, situation, action, outcome, skills, verification_status, excluded_from_ai, start_date, end_date")
      .eq("user_id", actor.userId)
      .limit(40),
    supabase.from("profiles").select("location_city, location_country").eq("id", actor.userId).maybeSingle(),
    supabase.from("profile_facts").select("id, category, value, verification_status").eq("user_id", actor.userId).limit(40),
  ]);

  return {
    evidence: (evidence ?? []).map((row) => ({
      id: row.id as string,
      title: String(row.title ?? ""),
      kind: String(row.kind ?? "other"),
      organization: (row.organization as string | null) ?? null,
      situation: (row.situation as string | null) ?? null,
      action: (row.action as string | null) ?? null,
      outcome: (row.outcome as string | null) ?? null,
      skills: Array.isArray(row.skills) ? (row.skills as string[]) : [],
      verificationStatus: (row.verification_status as MemoryEvidence["verificationStatus"]) ?? "unverified",
      excludedFromAi: Boolean(row.excluded_from_ai),
      startDate: (row.start_date as string | null) ?? null,
      endDate: (row.end_date as string | null) ?? null,
    })),
    context: {
      locationCity: profile?.location_city ?? null,
      locationCountry: profile?.location_country ?? null,
      facts: (facts ?? []).map((row) => ({
        id: row.id as string,
        category: String(row.category ?? ""),
        value: typeof row.value === "string" ? row.value : JSON.stringify(row.value),
        verificationStatus: (row.verification_status as "unverified" | "verified" | "rejected") ?? "unverified",
      })),
    },
  };
}

/**
 * Strengthen Yes/No job-eligibility radios (degree/years) using Application Memory.
 * Never auto-fills "No". Commitment/status questions are skipped (LLM / Need You).
 */
export async function enrichYesNoEligibilityMappings(
  supabase: SupabaseClient,
  actor: Actor,
  mappings: FieldMapping[],
): Promise<FieldMapping[]> {
  const targets = mappings.filter(isYesNoEligibilityMapping);
  if (!targets.length) return mappings;

  const { evidence, context } = await loadEvidence(supabase, actor);
  if (!evidence.length && !context.facts?.length) return mappings;

  return mappings.map((mapping) => {
    if (!isYesNoEligibilityMapping(mapping)) return mapping;
    const labels = pickYesNo(mapping);
    if (!labels) return mapping;

    const education = evaluateRequirement(
      { id: `${mapping.fieldKey}:edu`, text: mapping.label, hard: true, kind: "education" },
      evidence,
      context,
    );
    const experience = evaluateRequirement(
      { id: `${mapping.fieldKey}:exp`, text: mapping.label, hard: true, kind: "experience" },
      evidence,
      context,
    );
    const lexical = evaluateRequirement(
      { id: `${mapping.fieldKey}:lex`, text: mapping.label, hard: true, kind: "general" },
      evidence,
      context,
    );

    const eduOk = education.state === "met" || education.state === "partial";
    const expOk = experience.state === "met" || experience.state === "partial";
    const lexOk = lexical.state === "met";
    const allowsEquivalent = /or equivalent/i.test(mapping.label);

    let answer: "yes" | null = null;
    let confidence = mapping.confidence;
    let reason = mapping.reason;

    if ((eduOk && expOk) || (allowsEquivalent && expOk) || lexOk) {
      answer = "yes";
      confidence = Math.max(confidence, eduOk && expOk ? 0.88 : 0.72);
      reason = [
        "Matched Application Memory for this eligibility question.",
        education.state !== "unclear" ? `Education: ${education.label}.` : null,
        experience.state !== "unclear" ? `Experience: ${experience.label}.` : null,
        lexical.state === "met" ? `Evidence: ${lexical.explanation.slice(0, 160)}` : null,
      ]
        .filter(Boolean)
        .join(" ");
    } else {
      reason = [
        "Not enough Application Memory to auto-select Yes. Left for Need You (never guess No).",
        `Education: ${education.label}.`,
        `Experience: ${experience.label}.`,
      ].join(" ");
    }

    if (!answer) {
      return {
        ...mapping,
        proposedValue: "",
        excludedByDefault: true,
        confidence: Math.min(confidence, 0.4),
        showChip: true,
        reason,
        aiAnswerable: true,
      };
    }

    return {
      ...mapping,
      proposedValue: labels.yes,
      confidence,
      excludedByDefault: false,
      memoryPath: "Eligibility → Application Memory",
      source: "Application Memory",
      reason,
      showChip: true,
      aiAnswerable: false,
      options: [
        { value: labels.yes, label: "Yes", source: "Form choice" },
        { value: labels.no, label: "No", source: "Form choice" },
      ],
    };
  });
}
