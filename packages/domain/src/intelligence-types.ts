import type { EligibilityState } from "@1apply/contracts";

export type MemoryEvidence = {
  id: string;
  title: string;
  kind: string;
  organization: string | null;
  situation: string | null;
  action: string | null;
  outcome: string | null;
  skills: string[];
  verificationStatus: "unverified" | "verified" | "rejected";
  excludedFromAi: boolean;
  startDate?: string | null;
  endDate?: string | null;
};

export type MemoryRequirement = {
  id: string;
  text: string;
  hard: boolean;
  kind?: string | null;
};

export type MemoryFact = {
  id: string;
  category: string;
  value: string;
  verificationStatus: "unverified" | "verified" | "rejected";
};

export type MemoryDocument = {
  type: string;
  label: string;
};

export type EligibilityContext = {
  locationCity?: string | null;
  locationCountry?: string | null;
  availability?: string | null;
  workAuthorization?: string | null;
  opportunityLocation?: string | null;
  facts?: MemoryFact[];
  documents?: MemoryDocument[];
};

export type EligibilityVerdict = {
  requirementId: string;
  requirementText: string;
  kind: string;
  hard: boolean;
  state: EligibilityState;
  label: string;
  explanation: string;
  evidenceId: string | null;
  needsConfirmation: boolean;
};

export type ResumeCandidate = {
  documentId: string;
  documentVersionId: string;
  label: string;
  type: string;
  text?: string | null;
  /** User remembrance category — matching may use it for auto-selection only, not filtering. */
  categoryKey?: string | null;
  categoryLabel?: string | null;
};

export function eligibleEvidence(items: MemoryEvidence[]): MemoryEvidence[] {
  return items.filter((item) => item.verificationStatus === "verified" && !item.excludedFromAi);
}

export function evidenceBlob(item: MemoryEvidence): string {
  return [
    item.title,
    item.kind,
    item.organization,
    item.situation,
    item.action,
    item.outcome,
    item.startDate,
    item.endDate,
    ...item.skills,
  ]
    .filter(Boolean)
    .join(" ");
}

export function verifiedFacts(facts: MemoryFact[] | undefined): MemoryFact[] {
  return (facts ?? []).filter((item) => item.verificationStatus === "verified");
}

export function verifiedSkills(evidence: MemoryEvidence[], facts?: MemoryFact[]): string[] {
  const names = [
    ...eligibleEvidence(evidence).flatMap((item) => item.skills),
    ...verifiedFacts(facts)
      .filter((item) => item.category === "skills")
      .map((item) => item.value),
  ];
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}
