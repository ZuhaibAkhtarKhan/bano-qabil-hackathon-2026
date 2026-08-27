import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryCategory } from "@1apply/contracts";
import { MEMORY_SECTIONS, categoryFromKind, memoryFactKey } from "@1apply/domain";

import { kitFillSchema, tryGetAiProvider } from "@/infra/ai/openai";
import { normalizeDocumentExtractionRaw, normalizeKitFillRaw } from "@/lib/kit-fill-normalize";
import { logError } from "@/lib/log";
import { wrapUntrustedDocumentContent } from "@/lib/opportunities/untrusted";
import { parseWorkspacePreferences } from "@/lib/workspace-preferences";
import { extractFromDocumentText } from "@/server/memory/extract-from-document";
import { isSubstantiveExtractedEvidence, planDocumentExtraction } from "@/server/memory/plan-extraction";
import {
  loadConflictCandidates,
  persistDocumentExtraction,
  syncMemoryConflicts,
} from "@/server/memory/persist-extraction";

const EVIDENCE_SECTIONS: MemoryCategory[] = [
  "education",
  "projects",
  "experience",
  "achievements",
  "certifications",
  "leadership",
  "research",
  "supporting",
];

const MAX_FILL_PASSES = 100;
/** Stop early when the model keeps returning nothing useful for this many calls in a row. */
const MAX_CONSECUTIVE_NO_PROGRESS = 8;
const PASS_DELAY_MS = 400;

export type KitBlankDescriptor = {
  id: string;
  section: MemoryCategory | "personal";
  label: string;
};

function isBlank(value: string | null | undefined): boolean {
  return !String(value ?? "").trim();
}

function categoryHasSubstantiveEvidence(
  evidence: Array<{ kind: string; source: string | null; organization: string | null; title: string | null; situation: string | null; action: string | null; outcome: string | null }>,
  section: MemoryCategory,
): boolean {
  return evidence.some((row) => {
    if (categoryFromKind(String(row.kind ?? "project")) !== section) return false;
    if (row.source === "manual") return true;
    return isSubstantiveExtractedEvidence({
      title: String(row.title ?? ""),
      organization: row.organization,
      situation: row.situation,
      action: row.action,
      outcome: row.outcome,
    });
  });
}

export async function loadUserDocumentCorpus(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data: chunks } = await supabase
    .from("document_chunks")
    .select("content, chunk_index, document_version_id")
    .eq("user_id", userId)
    .order("document_version_id", { ascending: true })
    .order("chunk_index", { ascending: true })
    .limit(200);

  const joined = (chunks ?? [])
    .map((row) => String(row.content ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  return joined.slice(0, 72_000);
}

export async function detectKitBlanks(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ blanks: KitBlankDescriptor[]; corpus: string }> {
  const corpus = await loadUserDocumentCorpus(supabase, userId);
  const blanks: KitBlankDescriptor[] = [];

  const [{ data: profile }, { data: evidence }, { count: skillCount }, { data: links }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "display_name, headline, phone, location_city, location_country, availability, work_authorization, linkedin_url, github_url, portfolio_url, timezone, preferences",
      )
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("evidence_items")
      .select("kind, source, organization, title, situation, action, outcome")
      .eq("user_id", userId)
      .neq("verification_status", "rejected"),
    supabase.from("skills").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("profile_links").select("kind, url").eq("user_id", userId),
  ]);

  const prefs = parseWorkspacePreferences((profile?.preferences as Record<string, unknown> | null) ?? {});
  const evidenceRows = evidence ?? [];
  const linkKinds = new Set((links ?? []).map((row) => String(row.kind ?? "")));

  const personalChecks: Array<[string, string, boolean]> = [
    ["personal:display_name", "Full name", isBlank(profile?.display_name)],
    ["personal:university", "University", isBlank(prefs.university)],
    ["personal:education_summary", "Education summary", isBlank(prefs.educationSummary)],
    ["personal:headline", "Headline / professional title", isBlank(profile?.headline)],
    ["personal:phone", "Phone number", isBlank(profile?.phone)],
    ["personal:location_city", "City", isBlank(profile?.location_city)],
    ["personal:location_country", "Country", isBlank(profile?.location_country)],
    ["personal:availability", "Availability", isBlank(profile?.availability)],
    ["personal:work_authorization", "Work authorization", isBlank(profile?.work_authorization)],
    ["personal:timezone", "Timezone (IANA, e.g. Asia/Karachi)", isBlank(profile?.timezone)],
    ["personal:linkedin", "LinkedIn URL", isBlank(profile?.linkedin_url) && !linkKinds.has("linkedin")],
    ["personal:github", "GitHub URL", isBlank(profile?.github_url) && !linkKinds.has("github")],
    ["personal:portfolio", "Portfolio URL", isBlank(profile?.portfolio_url) && !linkKinds.has("portfolio")],
  ];

  for (const [id, label, missing] of personalChecks) {
    if (missing) blanks.push({ id, section: "personal", label });
  }

  for (const section of EVIDENCE_SECTIONS) {
    if (!categoryHasSubstantiveEvidence(evidenceRows, section)) {
      blanks.push({
        id: `section:${section}`,
        section,
        label: `${MEMORY_SECTIONS.find((item) => item.id === section)?.label ?? section} entries`,
      });
    }
  }

  if ((skillCount ?? 0) === 0) {
    blanks.push({ id: "section:skills", section: "skills", label: "Skills list" });
  }

  if (isBlank(profile?.linkedin_url) && !linkKinds.has("linkedin")) {
    blanks.push({ id: "links:linkedin", section: "links", label: "LinkedIn profile link" });
  }
  if (isBlank(profile?.github_url) && !linkKinds.has("github")) {
    blanks.push({ id: "links:github", section: "links", label: "GitHub profile link" });
  }
  if (isBlank(profile?.portfolio_url) && !linkKinds.has("portfolio")) {
    blanks.push({ id: "links:portfolio", section: "links", label: "Portfolio / website link" });
  }

  return { blanks, corpus };
}

function buildFillInstruction(blanks: KitBlankDescriptor[]): string {
  const lines = blanks.map((blank) => `- ${blank.label} (${blank.section})`);
  const focus =
    blanks.length === 1
      ? `Focus on this ONE blank field only: ${blanks[0].label} (${blanks[0].section}).`
      : "Fill ONLY the blank kit fields listed below.";
  return [
    `${focus} Use facts explicitly stated in the uploaded document text.`,
    "Return JSON matching the schema. Include every field you can support from the document; omit keys you cannot support.",
    "Never invent employers, dates, credentials, or contact details.",
    "Personal profile mapping:",
    "- Resume name → displayName; degree line → educationSummary; school → university",
    "- Job title / headline → headline; phone, city, country from contact block",
    "- CNIC / B-form / national ID → nationalId plus name, phone, city, country when present",
    "Section mapping for evidence items:",
    "- education, employment→experience, project→projects, achievement→achievements",
    "- certification→certifications, leadership, research, volunteering→supporting",
    "Each evidence item needs a meaningful title and organization when the document provides them.",
    "Do not return section headers (e.g. 'EDUCATION') as evidence titles.",
    'Return JSON only. "skills" must be a string array. "evidence" and "links" must be arrays, not objects.',
    "",
    "Blank fields to fill:",
    ...lines,
  ].join("\n");
}

function buildDocumentContext(input: {
  uploadedText: string;
  documentLabel: string;
  corpus: string;
}): string {
  const primary = wrapUntrustedDocumentContent(input.uploadedText.slice(0, 48_000), input.documentLabel);
  const corpus = input.corpus.trim();
  if (!corpus || corpus === input.uploadedText.trim()) return primary;
  return [
    primary,
    "",
    wrapUntrustedDocumentContent(corpus.slice(0, 24_000), "Other uploaded kit documents"),
  ].join("\n\n");
}

async function applyKitFillResult(input: {
  supabase: SupabaseClient;
  userId: string;
  data: ReturnType<typeof kitFillSchema.parse>;
  sourceDocumentId?: string;
  sourceVersionId?: string;
}): Promise<boolean> {
  const { data: profileRow } = await input.supabase
    .from("profiles")
    .select(
      "display_name, headline, phone, location_city, location_country, availability, work_authorization, linkedin_url, github_url, portfolio_url, timezone, preferences",
    )
    .eq("id", input.userId)
    .maybeSingle();

  const prefs = parseWorkspacePreferences((profileRow?.preferences as Record<string, unknown> | null) ?? {});
  const profilePatch: Record<string, string | null> = {};
  const nextPrefs = { ...prefs };
  let changed = false;

  const p = input.data.profile ?? {};
  if (isBlank(profileRow?.display_name) && p.displayName?.trim()) profilePatch.display_name = p.displayName.trim();
  if (isBlank(profileRow?.headline) && p.headline?.trim()) profilePatch.headline = p.headline.trim();
  if (isBlank(profileRow?.phone) && p.phone?.trim()) profilePatch.phone = p.phone.trim();
  if (isBlank(profileRow?.location_city) && p.locationCity?.trim()) profilePatch.location_city = p.locationCity.trim();
  if (isBlank(profileRow?.location_country) && p.locationCountry?.trim()) profilePatch.location_country = p.locationCountry.trim();
  if (isBlank(profileRow?.availability) && p.availability?.trim()) profilePatch.availability = p.availability.trim();
  if (isBlank(profileRow?.work_authorization) && p.workAuthorization?.trim()) {
    profilePatch.work_authorization = p.workAuthorization.trim();
  }
  if (isBlank(profileRow?.timezone) && p.timezone?.trim()) profilePatch.timezone = p.timezone.trim();
  if (isBlank(profileRow?.linkedin_url) && p.linkedinUrl?.trim()) profilePatch.linkedin_url = p.linkedinUrl.trim();
  if (isBlank(profileRow?.github_url) && p.githubUrl?.trim()) profilePatch.github_url = p.githubUrl.trim();
  if (isBlank(profileRow?.portfolio_url) && p.portfolioUrl?.trim()) profilePatch.portfolio_url = p.portfolioUrl.trim();
  if (isBlank(prefs.university) && p.university?.trim()) nextPrefs.university = p.university.trim();
  if (isBlank(prefs.educationSummary) && p.educationSummary?.trim()) {
    nextPrefs.educationSummary = p.educationSummary.trim();
  }

  if (
    Object.keys(profilePatch).length > 0 ||
    nextPrefs.university !== prefs.university ||
    nextPrefs.educationSummary !== prefs.educationSummary
  ) {
    await input.supabase
      .from("profiles")
      .update({
        ...profilePatch,
        preferences: nextPrefs,
      })
      .eq("id", input.userId);
    changed = true;
  }

  if (p.nationalId?.trim() && input.sourceDocumentId && input.sourceVersionId) {
    const factKey = memoryFactKey({ category: "personal", field: "national_id", title: "identity" });
    const { data: existing } = await input.supabase
      .from("profile_facts")
      .select("id")
      .eq("user_id", input.userId)
      .eq("fact_key", factKey)
      .maybeSingle();
    if (!existing) {
      await input.supabase.from("profile_facts").insert({
        user_id: input.userId,
        category: "personal",
        fact_type: "national_id",
        fact_key: factKey,
        value: { text: p.nationalId.trim() },
        source: `document:${input.sourceDocumentId}`,
        source_document_id: input.sourceDocumentId,
        source_version_id: input.sourceVersionId,
        extraction_status: "extracted",
        verification_status: "verified",
      });
      changed = true;
    }
  }

  const substantiveEvidence = (input.data.evidence ?? []).filter((item) => isSubstantiveExtractedEvidence(item));

  if (
    input.sourceDocumentId &&
    input.sourceVersionId &&
    (substantiveEvidence.length > 0 || (input.data.skills?.length ?? 0) > 0 || (input.data.links?.length ?? 0) > 0)
  ) {
    const existing = await loadConflictCandidates(input.supabase, input.userId);
    const plan = planDocumentExtraction(
      {
        displayName: p.displayName ?? null,
        headline: p.headline ?? null,
        phone: p.phone ?? null,
        locationCity: p.locationCity ?? null,
        locationCountry: p.locationCountry ?? null,
        links: input.data.links,
        skills: input.data.skills,
        evidence: substantiveEvidence,
      },
      existing,
    );

    if (plan.evidence.length > 0 || plan.skills.length > 0 || plan.links.length > 0) {
      await persistDocumentExtraction(input.supabase, {
        userId: input.userId,
        documentId: input.sourceDocumentId,
        versionId: input.sourceVersionId,
        documentLabel: "Kit auto-fill",
        evidence: plan.evidence,
        facts: [],
        skills: plan.skills,
        links: plan.links,
      });
      changed = true;
    }
  }

  return changed;
}

async function runKitFillPass(input: {
  supabase: SupabaseClient;
  userId: string;
  blanks: KitBlankDescriptor[];
  uploadedText: string;
  documentLabel: string;
  corpus: string;
  sourceDocumentId?: string;
  sourceVersionId?: string;
}): Promise<boolean> {
  const provider = tryGetAiProvider();
  if (!provider) return false;

  const raw = await provider.completeStructured({
    schemaName: "kitFill",
    instruction: buildFillInstruction(input.blanks),
    untrustedData: buildDocumentContext({
      uploadedText: input.uploadedText,
      documentLabel: input.documentLabel,
      corpus: input.corpus,
    }),
  });
  const parsed = kitFillSchema.safeParse(normalizeKitFillRaw(raw));
  if (!parsed.success) {
    logError("memory.kit_fill_parse_failed", {
      issues: parsed.error.issues.slice(0, 5).map((issue) => issue.message),
    });
    return false;
  }

  return applyKitFillResult({
    supabase: input.supabase,
    userId: input.userId,
    data: parsed.data,
    sourceDocumentId: input.sourceDocumentId,
    sourceVersionId: input.sourceVersionId,
  });
}

/** Fill every remaining kit blank from the uploaded document, re-running the LLM until blanks are exhausted. */
export async function fillKitBlanksFromUploadedDocument(input: {
  supabase: SupabaseClient;
  userId: string;
  extractedText: string;
  documentLabel: string;
  sourceDocumentId: string;
  sourceVersionId: string;
  maxPasses?: number;
}): Promise<{ filled: boolean; blankCount: number; passes: number }> {
  const uploadedText = input.extractedText.trim();
  if (!uploadedText) {
    return { filled: false, blankCount: 0, passes: 0 };
  }

  let passes = 0;
  let anyFilled = false;
  let noProgressStreak = 0;
  const maxPasses = input.maxPasses ?? MAX_FILL_PASSES;

  while (passes < maxPasses) {
    const { blanks, corpus } = await detectKitBlanks(input.supabase, input.userId);
    if (blanks.length === 0) break;

    const targetBlanks = [blanks[passes % blanks.length]];

    try {
      const changed = await runKitFillPass({
        supabase: input.supabase,
        userId: input.userId,
        blanks: targetBlanks,
        uploadedText,
        documentLabel: input.documentLabel,
        corpus,
        sourceDocumentId: input.sourceDocumentId,
        sourceVersionId: input.sourceVersionId,
      });
      if (changed) {
        anyFilled = true;
        noProgressStreak = 0;
      } else {
        noProgressStreak += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      logError("memory.kit_fill_failed", {
        userId: input.userId,
        pass: passes + 1,
        message,
      });
      noProgressStreak += 1;
      if (!anyFilled && noProgressStreak >= MAX_CONSECUTIVE_NO_PROGRESS) break;
    }

    passes += 1;
    if (noProgressStreak >= MAX_CONSECUTIVE_NO_PROGRESS) break;

    const { blanks: remaining } = await detectKitBlanks(input.supabase, input.userId);
    if (remaining.length === 0) break;

    if (passes < maxPasses) {
      await new Promise((resolve) => setTimeout(resolve, PASS_DELAY_MS));
    }
  }

  await syncMemoryConflicts(input.supabase, input.userId);

  const { blanks: finalBlanks } = await detectKitBlanks(input.supabase, input.userId);
  return { filled: anyFilled, blankCount: finalBlanks.length, passes };
}

export async function fillKitBlanksFromCorpus(input: {
  supabase: SupabaseClient;
  userId: string;
  profileDisplayName: string | null;
  sourceDocumentId?: string;
  sourceVersionId?: string;
  extractedText?: string;
  documentLabel?: string;
}): Promise<{ filled: boolean; blankCount: number }> {
  const { blanks, corpus } = await detectKitBlanks(input.supabase, input.userId);
  if (blanks.length === 0 || !corpus.trim()) {
    return { filled: false, blankCount: blanks.length };
  }

  if (input.extractedText?.trim() && input.sourceDocumentId && input.sourceVersionId) {
    return fillKitBlanksFromUploadedDocument({
      supabase: input.supabase,
      userId: input.userId,
      extractedText: input.extractedText,
      documentLabel: input.documentLabel ?? "Uploaded document",
      sourceDocumentId: input.sourceDocumentId,
      sourceVersionId: input.sourceVersionId,
    });
  }

  try {
    const changed = await runKitFillPass({
      supabase: input.supabase,
      userId: input.userId,
      blanks,
      uploadedText: corpus,
      documentLabel: "All uploaded kit documents",
      corpus: "",
      sourceDocumentId: input.sourceDocumentId,
      sourceVersionId: input.sourceVersionId,
    });
    await syncMemoryConflicts(input.supabase, input.userId);
    return { filled: changed, blankCount: blanks.length };
  } catch (error) {
    logError("memory.kit_fill_failed", {
      userId: input.userId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return { filled: false, blankCount: blanks.length };
  }
}

/** Fill kit blanks from the uploaded document text, then fall back to legacy extraction if needed. */
export async function extractAndFillKitFromDocument(input: {
  supabase: SupabaseClient;
  userId: string;
  documentId: string;
  versionId: string;
  documentLabel: string;
  extractedText: string;
  profileDisplayName: string | null;
}) {
  const fill = await fillKitBlanksFromUploadedDocument({
    supabase: input.supabase,
    userId: input.userId,
    extractedText: input.extractedText,
    documentLabel: input.documentLabel,
    sourceDocumentId: input.documentId,
    sourceVersionId: input.versionId,
  });

  if (fill.filled) {
    return { extracted: true as const, conflictCount: 0, fillPasses: fill.passes, remainingBlanks: fill.blankCount };
  }

  const extracted = await extractFromDocumentText(input);
  if (extracted.extracted) {
    return extracted;
  }

  const retry = await fillKitBlanksFromUploadedDocument({
    supabase: input.supabase,
    userId: input.userId,
    extractedText: input.extractedText,
    documentLabel: input.documentLabel,
    sourceDocumentId: input.documentId,
    sourceVersionId: input.versionId,
  });
  return {
    extracted: retry.filled,
    conflictCount: 0,
    fillPasses: retry.passes,
    remainingBlanks: retry.blankCount,
  };
}
