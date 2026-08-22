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
};

export type CandidateProfile = {
  locationCity?: string | null;
  locationCountry?: string | null;
  availability?: string | null;
  workAuthorization?: string | null;
};

export type MemoryRequirement = {
  id: string;
  text: string;
  hard: boolean;
  kind?: string | null;
};

export type RequirementKind =
  | "education"
  | "degree"
  | "graduation_year"
  | "location"
  | "experience"
  | "skills"
  | "availability"
  | "other";

export type EligibilityState =
  | "met"
  | "not_met"
  | "unclear"
  | "not_evaluated"
  | "partial"
  | "needs_confirmation";

export type EligibilityDisplayState =
  | "SATISFIED"
  | "NOT SATISFIED"
  | "UNKNOWN"
  | "PARTIAL"
  | "NEEDS CONFIRMATION";

export type EligibilityVerdict = {
  requirementId: string;
  requirementText: string;
  kind: RequirementKind;
  hard: boolean;
  state: EligibilityState;
  displayState: EligibilityDisplayState;
  explanation: string;
  evidenceId: string | null;
};

export type ResumeTrack = "software_engineering" | "ai_ml" | "web_development" | "research" | "general";

export type ResumeCandidate = {
  documentId: string;
  documentVersionId: string;
  label: string;
  type: string;
  content?: string | null;
};

export function eligibleEvidence(items: MemoryEvidence[]): MemoryEvidence[] {
  return items.filter((item) => item.verificationStatus === "verified" && !item.excludedFromAi);
}

export function evidenceBlob(item: MemoryEvidence): string {
  return [item.title, item.kind, item.organization, item.situation, item.action, item.outcome, ...item.skills]
    .filter(Boolean)
    .join(" ");
}
