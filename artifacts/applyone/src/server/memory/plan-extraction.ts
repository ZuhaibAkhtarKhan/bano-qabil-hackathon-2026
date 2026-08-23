import type { ExperienceKind, MemoryCategory } from "@1apply/contracts";
import { categoryFromKind, detectMemoryConflicts, memoryFactKey, type ConflictCandidate } from "@1apply/domain";

import { mapExtractedEvidenceKind, uniqueSkillNames } from "@/lib/extraction";

export type ExtractedDocument = {
  displayName: string | null;
  headline: string | null;
  phone?: string | null;
  locationCity?: string | null;
  locationCountry?: string | null;
  links?: Array<{ kind: string; url: string }>;
  skills?: string[];
  evidence: Array<{
    title: string;
    kind: string;
    organization: string | null;
    situation: string | null;
    action: string | null;
    outcome: string | null;
    skills: string[];
    startDate?: string | null;
    endDate?: string | null;
    excerpt?: string | null;
  }>;
};

export type PlannedEvidence = {
  title: string;
  kind: ExperienceKind;
  category: MemoryCategory;
  organization: string | null;
  situation: string | null;
  action: string | null;
  outcome: string | null;
  skills: string[];
  startDate: string | null;
  endDate: string | null;
  excerpt: string | null;
  factKey: string;
  extractionStatus: "extracted";
  verificationStatus: "unverified";
};

export type PlannedScalarFact = {
  category: MemoryCategory;
  factKey: string;
  value: string;
  extractionStatus: "extracted";
  verificationStatus: "unverified";
};

export function planDocumentExtraction(
  extracted: ExtractedDocument,
  existingFacts: ConflictCandidate[],
) {
  const evidence: PlannedEvidence[] = extracted.evidence.slice(0, 20).map((item) => {
    const kind = mapExtractedEvidenceKind(item.kind);
    const category = categoryFromKind(kind);
    return {
      title: item.title.slice(0, 180),
      kind,
      category,
      organization: item.organization,
      situation: item.situation,
      action: item.action,
      outcome: item.outcome,
      skills: item.skills.slice(0, 16),
      startDate: item.startDate ?? null,
      endDate: item.endDate ?? null,
      excerpt: item.excerpt ?? null,
      factKey: memoryFactKey({
        category,
        organization: item.organization,
        title: item.title,
        field: item.endDate ? "end_year" : "title",
      }),
      extractionStatus: "extracted",
      verificationStatus: "unverified",
    };
  });

  const facts: PlannedScalarFact[] = [];
  if (extracted.displayName?.trim()) {
    facts.push({
      category: "personal",
      factKey: memoryFactKey({ category: "personal", field: "display_name", title: "identity" }),
      value: extracted.displayName.trim(),
      extractionStatus: "extracted",
      verificationStatus: "unverified",
    });
  }
  if (extracted.headline?.trim()) {
    facts.push({
      category: "personal",
      factKey: memoryFactKey({ category: "personal", field: "headline", title: "identity" }),
      value: extracted.headline.trim(),
      extractionStatus: "extracted",
      verificationStatus: "unverified",
    });
  }
  if (extracted.phone?.trim()) {
    facts.push({
      category: "personal",
      factKey: memoryFactKey({ category: "personal", field: "phone", title: "identity" }),
      value: extracted.phone.trim(),
      extractionStatus: "extracted",
      verificationStatus: "unverified",
    });
  }

  for (const item of evidence) {
    if (!item.endDate) continue;
    facts.push({
      category: item.category,
      factKey: memoryFactKey({
        category: item.category,
        organization: item.organization,
        title: item.title,
        field: "end_year",
      }),
      value: item.endDate,
      extractionStatus: "extracted",
      verificationStatus: "unverified",
    });
  }

  const plannedFacts: ConflictCandidate[] = [
    ...existingFacts,
    ...facts.map((fact, index) => ({
      id: `new-fact-${index}`,
      userId: existingFacts[0]?.userId ?? "pending",
      factKey: fact.factKey,
      category: fact.category,
      value: fact.value,
      verificationStatus: fact.verificationStatus,
    })),
  ];

  const skills = uniqueSkillNames([...(extracted.skills ?? []), ...evidence.flatMap((item) => item.skills)]);
  const links = (extracted.links ?? [])
    .map((link) => {
      const kind: "linkedin" | "github" | "portfolio" | "other" =
        link.kind === "linkedin" || link.kind === "github" || link.kind === "portfolio" ? link.kind : "other";
      return { kind, url: link.url.trim() };
    })
    .filter((link) => /^https?:\/\//i.test(link.url));

  return {
    evidence,
    facts,
    skills,
    links,
    conflicts: detectMemoryConflicts(plannedFacts),
  };
}
