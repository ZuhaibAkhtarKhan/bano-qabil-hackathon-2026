import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryCategory } from "@1apply/contracts";
import { MEMORY_SECTIONS, categoryFromKind, memoryFactKey } from "@1apply/domain";

import { kitFillSchema, tryGetAiProvider } from "@/infra/ai/openai";
import { normalizeKitFillRaw } from "@/lib/kit-fill-normalize";
import { logError, logInfo } from "@/lib/log";
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

const MAX_FILL_PASSES = 6;
const MAX_CONSECUTIVE_NO_PROGRESS = 3;
const PASS_DELAY_MS = 250;

/** Always ask the model to scan every kit category from this document. */
const FULL_KIT_SCAN_BLANKS: KitBlankDescriptor[] = [
  {
    id: "scan:personal",
    section: "personal",
    label: "Personal profile (name, university, education, headline, phone, location, availability, work authorization, timezone, links)",
  },
  { id: "scan:skills", section: "skills", label: "Skills list" },
  ...EVIDENCE_SECTIONS.map((section) => ({
    id: `scan:${section}`,
    section,
    label: `${MEMORY_SECTIONS.find((item) => item.id === section)?.label ?? section} entries`,
  })),
  { id: "scan:links", section: "links", label: "LinkedIn, GitHub, and portfolio links" },
];

export type KitBlankDescriptor = {
  id: string;
  section: MemoryCategory | "personal";
  label: string;
};

export type KitFillWriteStats = {
  filled: boolean;
  blankCount: number;
  passes: number;
  fieldsWritten: number;
};

function isBlank(value: string | null | undefined): boolean {
  return !String(value ?? "").trim();
}

function categoryHasSubstantiveEvidence(
  evidence: Array<{
    kind: string;
    source: string | null;
    organization: string | null;
    title: string | null;
    situation: string | null;
    action: string | null;
    outcome: string | null;
  }>,
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
      excerpt: null,
    });
  });
}

export async function loadUserDocumentCorpus(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data: chunks } = await supabase
    .from("document_chunks")
    .select("content, chunk_index, document_version_id")
    .eq("user_id", userId)
    .order("document_version_id", { ascending: true })
    .order("chunk_index", { ascending: true });

  return (chunks ?? [])
    .map((row) => String(row.content ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
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
  const lines = blanks.map((blank) => `- ${blank.label} [${blank.section}]`);
  return [
    "You are filling the applicant's Your kit from uploaded document text.",
    "Read the ENTIRE document. Decide which empty kit fields below can be filled and map each fact to the correct category.",
    "",
    "Be CONFIDENT: when the document clearly contains or strongly implies a value, include it.",
    "Use reasonable inference from context:",
    "- Name from header, CNIC, or signature block → displayName",
    "- Degree line → educationSummary; school/university name → university",
    "- Current or most recent role → headline",
    "- Phone, city, country from contact block, CNIC, or letterhead",
    "- Country/city → timezone (e.g. Pakistan → Asia/Karachi, UAE → Asia/Dubai)",
    "- Nationality or work-eligibility cues → workAuthorization when stated or clearly implied",
    "- Open-to-work / immediate availability language → availability",
    "- Skills section plus tools and languages mentioned in jobs and projects → skills array",
    "- URLs and handles → links (linkedin, github, portfolio)",
    "",
    "Evidence kinds and kit sections (you choose the best fit per entry):",
    "- education → Education; employment → Experience; project → Projects",
    "- achievement → Achievements; certification → Certifications",
    "- leadership → Leadership; research → Research; volunteering → Supporting Evidence",
    "",
    "For each evidence item: title = role/degree/project name; organization = employer or school;",
    "situation/action/outcome from resume bullets; startDate/endDate as YYYY-MM-DD when possible",
    "(use null for Present/Current/ongoing — never the word Present).",
    "Extract EVERY education, job, project, achievement, certification, leadership, and research entry present.",
    "Never use bare headers like EDUCATION as titles.",
    "",
    'Return JSON only: { profile?, skills?, evidence?, links? }.',
    '"skills" must be a string array. "evidence" and "links" must be arrays, not objects.',
    "Fill every listed blank the document supports. Omit only when there is truly no signal.",
    "Do not fabricate employers, credentials, or contact details that are nowhere in the text.",
    "",
    "Kit fields / categories to fill:",
    ...lines,
  ].join("\n");
}

async function applyKitFillResult(input: {
  supabase: SupabaseClient;
  userId: string;
  data: ReturnType<typeof kitFillSchema.parse>;
  sourceDocumentId?: string;
  sourceVersionId?: string;
}): Promise<number> {
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
  let fieldsWritten = 0;

  const p = input.data.profile ?? {};
  if (isBlank(profileRow?.display_name) && p.displayName?.trim()) {
    profilePatch.display_name = p.displayName.trim();
  }
  if (isBlank(profileRow?.headline) && p.headline?.trim()) profilePatch.headline = p.headline.trim();
  if (isBlank(profileRow?.phone) && p.phone?.trim()) profilePatch.phone = p.phone.trim();
  if (isBlank(profileRow?.location_city) && p.locationCity?.trim()) profilePatch.location_city = p.locationCity.trim();
  if (isBlank(profileRow?.location_country) && p.locationCountry?.trim()) {
    profilePatch.location_country = p.locationCountry.trim();
  }
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

  const prefsChanged =
    nextPrefs.university !== prefs.university || nextPrefs.educationSummary !== prefs.educationSummary;
  if (Object.keys(profilePatch).length > 0 || prefsChanged) {
    const { error } = await input.supabase
      .from("profiles")
      .update({
        ...profilePatch,
        preferences: nextPrefs,
      })
      .eq("id", input.userId);
    if (error) {
      logError("memory.kit_fill_profile_update_failed", { message: error.message });
    } else {
      fieldsWritten += Object.keys(profilePatch).length + (prefsChanged ? 1 : 0);
    }
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
      const { error } = await input.supabase.from("profile_facts").insert({
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
      if (error) {
        logError("memory.kit_fill_national_id_failed", { message: error.message });
      } else {
        fieldsWritten += 1;
      }
    }
  }

  const substantiveEvidence = (input.data.evidence ?? []).filter((item) =>
    isSubstantiveExtractedEvidence({
      ...item,
      situation: item.situation ?? item.excerpt ?? null,
    }),
  );

  if (
    input.sourceDocumentId &&
    input.sourceVersionId &&
    (substantiveEvidence.length > 0 || (input.data.skills?.length ?? 0) > 0 || (input.data.links?.length ?? 0) > 0)
  ) {
    const existing = await loadConflictCandidates(input.supabase, input.userId);
    const existingKeys = new Set(existing.map((row) => row.factKey));
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

    const newEvidence = plan.evidence.filter((item) => !existingKeys.has(item.factKey));
    if (newEvidence.length > 0 || plan.skills.length > 0 || plan.links.length > 0) {
      const persisted = await persistDocumentExtraction(input.supabase, {
        userId: input.userId,
        documentId: input.sourceDocumentId,
        versionId: input.sourceVersionId,
        documentLabel: "Kit auto-fill",
        evidence: newEvidence,
        facts: [],
        skills: plan.skills,
        links: plan.links,
      });
      fieldsWritten +=
        persisted.insertedEvidenceIds.length + plan.skills.length + plan.links.length;
    }
  }

  return fieldsWritten;
}

async function runKitFillPass(input: {
  supabase: SupabaseClient;
  userId: string;
  blanks: KitBlankDescriptor[];
  uploadedText: string;
  documentLabel: string;
  sourceDocumentId?: string;
  sourceVersionId?: string;
}): Promise<number> {
  const provider = tryGetAiProvider();
  if (!provider) {
    logError("memory.kit_fill_no_ai_provider", { userId: input.userId });
    return 0;
  }

  const raw = await provider.completeStructured({
    schemaName: "kitFill",
    instruction: buildFillInstruction(input.blanks),
    // Full extracted text only — never truncate, never pad with other-doc corpus.
    untrustedData: wrapUntrustedDocumentContent(input.uploadedText, input.documentLabel),
  });
  const parsed = kitFillSchema.safeParse(normalizeKitFillRaw(raw));
  if (!parsed.success) {
    logError("memory.kit_fill_parse_failed", {
      issues: parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
    return 0;
  }

  const profileKeys = Object.values(parsed.data.profile ?? {}).filter((value) => String(value ?? "").trim()).length;
  logInfo("memory.kit_fill_llm_ok", {
    userId: input.userId,
    profileFields: profileKeys,
    skills: parsed.data.skills?.length ?? 0,
    evidence: parsed.data.evidence?.length ?? 0,
    links: parsed.data.links?.length ?? 0,
  });

  return applyKitFillResult({
    supabase: input.supabase,
    userId: input.userId,
    data: parsed.data,
    sourceDocumentId: input.sourceDocumentId,
    sourceVersionId: input.sourceVersionId,
  });
}

/** Fill kit blanks from this document's extracted text (full text, no corpus). */
export async function fillKitBlanksFromUploadedDocument(input: {
  supabase: SupabaseClient;
  userId: string;
  extractedText: string;
  documentLabel: string;
  sourceDocumentId: string;
  sourceVersionId: string;
  maxPasses?: number;
  /** When true, always run a full-category scan even if heuristics report no blanks. */
  forceFullScan?: boolean;
}): Promise<KitFillWriteStats> {
  const uploadedText = input.extractedText.trim();
  if (!uploadedText) {
    return { filled: false, blankCount: 0, passes: 0, fieldsWritten: 0 };
  }

  let passes = 0;
  let fieldsWritten = 0;
  let noProgressStreak = 0;
  const maxPasses = input.maxPasses ?? MAX_FILL_PASSES;

  while (passes < maxPasses) {
    let { blanks } = await detectKitBlanks(input.supabase, input.userId);

    if (input.forceFullScan && passes === 0) {
      blanks = FULL_KIT_SCAN_BLANKS;
    } else if (blanks.length === 0 && passes === 0) {
      blanks = FULL_KIT_SCAN_BLANKS;
    }
    if (blanks.length === 0) break;

    try {
      const written = await runKitFillPass({
        supabase: input.supabase,
        userId: input.userId,
        blanks,
        uploadedText,
        documentLabel: input.documentLabel,
        sourceDocumentId: input.sourceDocumentId,
        sourceVersionId: input.sourceVersionId,
      });
      if (written > 0) {
        fieldsWritten += written;
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
      if (fieldsWritten === 0 && noProgressStreak >= MAX_CONSECUTIVE_NO_PROGRESS) break;
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
  return {
    filled: fieldsWritten > 0,
    blankCount: finalBlanks.length,
    passes,
    fieldsWritten,
  };
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
  if (input.extractedText?.trim() && input.sourceDocumentId && input.sourceVersionId) {
    return fillKitBlanksFromUploadedDocument({
      supabase: input.supabase,
      userId: input.userId,
      extractedText: input.extractedText,
      documentLabel: input.documentLabel ?? "Uploaded document",
      sourceDocumentId: input.sourceDocumentId,
      sourceVersionId: input.sourceVersionId,
      forceFullScan: true,
    });
  }

  const { blanks, corpus } = await detectKitBlanks(input.supabase, input.userId);
  if (blanks.length === 0 || !corpus.trim()) {
    return { filled: false, blankCount: blanks.length };
  }

  try {
    const written = await runKitFillPass({
      supabase: input.supabase,
      userId: input.userId,
      blanks,
      uploadedText: corpus,
      documentLabel: "All uploaded kit documents",
      sourceDocumentId: input.sourceDocumentId,
      sourceVersionId: input.sourceVersionId,
    });
    await syncMemoryConflicts(input.supabase, input.userId);
    return { filled: written > 0, blankCount: blanks.length };
  } catch (error) {
    logError("memory.kit_fill_failed", {
      userId: input.userId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return { filled: false, blankCount: blanks.length };
  }
}

/**
 * After text extraction: force a full-kit LLM fill from this document, then legacy extract, then mop-up.
 * Notifications must use fieldsWritten from THIS run — not pre-existing kit content.
 */
export async function extractAndFillKitFromDocument(input: {
  supabase: SupabaseClient;
  userId: string;
  documentId: string;
  versionId: string;
  documentLabel: string;
  extractedText: string;
  profileDisplayName: string | null;
}) {
  const fillInput = {
    supabase: input.supabase,
    userId: input.userId,
    extractedText: input.extractedText,
    documentLabel: input.documentLabel,
    sourceDocumentId: input.documentId,
    sourceVersionId: input.versionId,
  };

  logInfo("memory.kit_fill_start", {
    userId: input.userId,
    versionId: input.versionId,
    textChars: input.extractedText.trim().length,
  });

  // Pass 1: always scan every kit category from this document's full text.
  const primary = await fillKitBlanksFromUploadedDocument({
    ...fillInput,
    forceFullScan: true,
    maxPasses: 3,
  });

  let legacyFieldsWritten = 0;
  let conflictCount = 0;
  try {
    const legacy = await extractFromDocumentText(input);
    legacyFieldsWritten = "fieldsWritten" in legacy ? Number(legacy.fieldsWritten ?? 0) : 0;
    conflictCount = "conflictCount" in legacy ? Number(legacy.conflictCount ?? 0) : 0;
  } catch (error) {
    logError("memory.extract_ai_failed", {
      versionId: input.versionId,
      message: error instanceof Error ? error.message : "unknown",
    });
  }

  // Pass 2: mop up any blanks still empty after primary + legacy.
  const mopUp = await fillKitBlanksFromUploadedDocument({
    ...fillInput,
    forceFullScan: false,
    maxPasses: 3,
  });

  await syncMemoryConflicts(input.supabase, input.userId);

  const fieldsWritten = primary.fieldsWritten + mopUp.fieldsWritten + legacyFieldsWritten;
  const kitFilled = fieldsWritten > 0;
  const remainingBlanks = mopUp.blankCount;

  logInfo("memory.kit_fill_done", {
    userId: input.userId,
    versionId: input.versionId,
    fieldsWritten,
    primaryWritten: primary.fieldsWritten,
    mopUpWritten: mopUp.fieldsWritten,
    legacyFieldsWritten,
    remainingBlanks,
    passes: primary.passes + mopUp.passes,
  });

  return {
    extracted: kitFilled,
    conflictCount,
    fillPasses: primary.passes + mopUp.passes,
    remainingBlanks,
    fieldsWritten,
  };
}
