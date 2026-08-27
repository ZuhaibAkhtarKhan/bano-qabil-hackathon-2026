import {
  buildAutoResumeSelection,
  computeFitIndex,
  evaluateEligibility,
  rankResumes,
  type EligibilityContext,
  type MemoryEvidence,
} from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { mapEvidence } from "@/server/memory/map-evidence";
import type { EvidenceRow } from "@/server/types";

function factValue(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "text" in value) {
    return String((value as { text?: string }).text ?? "");
  }
  return JSON.stringify(value);
}

export async function loadIntelligenceContext(
  supabase: SupabaseClient,
  actor: Actor,
  opportunity: {
    title?: string | null;
    organization?: string | null;
    location?: string | null;
    category?: string | null;
    raw_excerpt?: string | null;
  } | null,
  requirementRows: Array<{ id: string; text: string; hard: boolean; kind?: string | null }>,
): Promise<{
  evidence: MemoryEvidence[];
  context: EligibilityContext;
  opportunityText: string;
  resumes: Array<{
    documentId: string;
    documentVersionId: string;
    label: string;
    type: string;
    text: string;
    categoryKey?: string | null;
    categoryLabel?: string | null;
  }>;
}> {
  const [
    { data: evidenceRows },
    { data: profile },
    { data: facts },
    { data: documents },
    { data: resumeMeta },
  ] = await Promise.all([
    supabase
      .from("evidence_items")
      .select(
        "id, title, kind, organization, situation, action, outcome, skills, verification_status, excluded_from_ai, start_date, end_date",
      )
      .eq("user_id", actor.userId),
    supabase
      .from("profiles")
      .select("location_city, location_country, availability, work_authorization, preferences")
      .eq("id", actor.userId)
      .maybeSingle(),
    supabase
      .from("profile_facts")
      .select("id, category, value, verification_status")
      .eq("user_id", actor.userId),
    supabase
      .from("documents")
      .select("id, label, type, current_version_id")
      .eq("user_id", actor.userId)
      // Score every resume/variant — category is remembrance-only and must not filter matching.
      .in("type", ["resume", "resume_variant"]),
    supabase.from("resumes").select("document_id, category_key, category_label").eq("user_id", actor.userId),
  ]);

  const evidence = ((evidenceRows ?? []) as EvidenceRow[]).map(mapEvidence);
  const preferences =
    profile?.preferences && typeof profile.preferences === "object"
      ? (profile.preferences as Record<string, unknown>)
      : {};
  const preferenceFacts: EligibilityContext["facts"] = [];
  const university = typeof preferences.university === "string" ? preferences.university.trim() : "";
  const educationSummary =
    typeof preferences.educationSummary === "string" ? preferences.educationSummary.trim() : "";
  if (university) {
    preferenceFacts.push({
      id: "kit-pref-university",
      category: "education",
      value: university,
      verificationStatus: "verified",
    });
  }
  if (educationSummary) {
    preferenceFacts.push({
      id: "kit-pref-education-summary",
      category: "education",
      value: educationSummary,
      verificationStatus: "verified",
    });
  }

  const versionIds = (documents ?? [])
    .map((item) => item.current_version_id as string | null)
    .filter((id): id is string => Boolean(id));

  const { data: chunks } = versionIds.length
    ? await supabase
        .from("document_chunks")
        .select("document_version_id, content, chunk_index")
        .in("document_version_id", versionIds)
        .order("chunk_index", { ascending: true })
    : { data: [] as Array<{ document_version_id: string; content: string }> };

  const textByVersion = new Map<string, string[]>();
  for (const chunk of chunks ?? []) {
    const list = textByVersion.get(chunk.document_version_id) ?? [];
    list.push(chunk.content);
    textByVersion.set(chunk.document_version_id, list);
  }

  const opportunityText = [
    opportunity?.title,
    opportunity?.organization,
    opportunity?.location,
    opportunity?.category,
    opportunity?.raw_excerpt,
    ...requirementRows.map((item) => item.text),
  ]
    .filter(Boolean)
    .join(" ");

  const metaByDoc = new Map(
    (resumeMeta ?? []).map((row) => [
      String(row.document_id),
      { categoryKey: row.category_key as string | null, categoryLabel: row.category_label as string | null },
    ]),
  );

  return {
    evidence,
    context: {
      locationCity: profile?.location_city ?? null,
      locationCountry: profile?.location_country ?? null,
      availability: profile?.availability ?? null,
      workAuthorization: profile?.work_authorization ?? null,
      opportunityLocation: opportunity?.location ?? null,
      facts: [
        ...preferenceFacts,
        ...(facts ?? []).map((item) => ({
          id: item.id as string,
          category: String(item.category ?? "personal"),
          value: factValue(item.value),
          verificationStatus: item.verification_status as "unverified" | "verified" | "rejected",
        })),
      ],
      documents: (documents ?? []).map((item) => ({
        type: item.type as string,
        label: item.label as string,
      })),
    },
    opportunityText,
    resumes: (documents ?? [])
      .filter((item) => item.current_version_id)
      .map((item) => ({
        documentId: item.id as string,
        documentVersionId: item.current_version_id as string,
        label: item.label as string,
        type: item.type as string,
        text: (textByVersion.get(item.current_version_id as string) ?? []).join("\n"),
        categoryKey: metaByDoc.get(item.id as string)?.categoryKey ?? null,
        categoryLabel: metaByDoc.get(item.id as string)?.categoryLabel ?? (item.label as string),
      })),
  };
}

export async function persistResumeMatches(
  supabase: SupabaseClient,
  input: {
    userId: string;
    applicationId: string;
    resumes: ReturnType<typeof rankResumes>;
  },
) {
  const { userId, applicationId, resumes } = input;
  await supabase.from("resume_matches").delete().eq("application_id", applicationId);
  if (resumes.length === 0) return;
  await supabase.from("resume_matches").insert(
    resumes.map((item) => ({
      user_id: userId,
      application_id: applicationId,
      document_id: item.documentId,
      document_version_id: item.documentVersionId,
      score: item.score,
      suggestion: item.suggestion,
      label: item.label,
      focus: item.focus,
      explanation: item.explanation,
      strengths: item.strengths,
      gaps: item.gaps,
      recommended: item.recommended,
    })),
  );
}

export async function persistIntelligence(
  supabase: SupabaseClient,
  input: {
    userId: string;
    applicationId: string;
    eligibility: ReturnType<typeof evaluateEligibility>;
    fit: ReturnType<typeof computeFitIndex>;
    resumes: ReturnType<typeof rankResumes>;
  },
) {
  const { userId, applicationId, eligibility, fit, resumes } = input;

  await supabase.from("eligibility_results").delete().eq("application_id", applicationId);
  const eligibilityRows = eligibility.filter((item) => item.requirementId !== "none");
  if (eligibilityRows.length > 0) {
    await supabase.from("eligibility_results").insert(
      eligibilityRows.map((item) => ({
        user_id: userId,
        application_id: applicationId,
        requirement_id: item.requirementId,
        state: item.state,
        explanation: item.explanation,
        evidence_id: item.evidenceId,
        requirement_text: item.requirementText,
        requirement_kind: item.kind,
        needs_confirmation: item.needsConfirmation,
      })),
    );
  }

  await supabase.from("fit_evaluations").delete().eq("application_id", applicationId);
  await supabase.from("fit_evaluations").insert({
    user_id: userId,
    application_id: applicationId,
    score: fit.score,
    skills_match: fit.skillsMatch,
    experience_match: fit.experienceMatch,
    education_match: fit.educationMatch,
    project_relevance: fit.projectRelevance,
    eligibility: fit.eligibility,
    missing: fit.missing,
    rationale: fit.rationale,
    strengths: fit.strengths,
    factors: fit.factors,
    weights: fit.weights,
  });

  await persistResumeMatches(supabase, { userId, applicationId, resumes });
}

export async function evaluateApplicationIntelligence(
  supabase: SupabaseClient,
  actor: Actor,
  applicationId: string,
  opportunityId: string,
) {
  const [{ data: opportunity }, { data: requirements }] = await Promise.all([
    supabase
      .from("opportunities")
      .select("id, title, organization, raw_excerpt, location, category")
      .eq("id", opportunityId)
      .single(),
    supabase.from("requirements").select("id, text, hard, kind").eq("opportunity_id", opportunityId),
  ]);

  const requirementRows = (requirements ?? []).map((item) => ({
    id: item.id as string,
    text: item.text as string,
    hard: Boolean(item.hard),
    kind: (item.kind as string | null) ?? "general",
  }));

  const loaded = await loadIntelligenceContext(supabase, actor, opportunity, requirementRows);
  const eligibility = evaluateEligibility(requirementRows, loaded.evidence, loaded.context);
  const fit = computeFitIndex({
    eligibility,
    evidence: loaded.evidence,
    opportunityText: loaded.opportunityText,
    context: loaded.context,
  });
  const highlights = loaded.evidence
    .filter((item) => item.verificationStatus === "verified")
    .slice(0, 4)
    .map((item) => item.title);
  const selection = buildAutoResumeSelection(loaded.opportunityText, loaded.resumes, {
    memoryHighlights: highlights,
  });

  await persistIntelligence(supabase, {
    userId: actor.userId,
    applicationId,
    eligibility,
    fit,
    resumes: selection.ranked,
  });

  return { eligibility, fit, resumes: selection.ranked, resumeSelection: selection };
}
