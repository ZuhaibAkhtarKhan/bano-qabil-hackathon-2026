import type { MemoryEvidence } from "@1apply/domain";

export function mapEvidence(row: {
  id: string;
  title: string;
  kind: string;
  organization: string | null;
  situation: string | null;
  action: string | null;
  outcome: string | null;
  skills: string[] | null;
  verification_status: "unverified" | "verified" | "rejected";
  excluded_from_ai: boolean;
  start_date?: string | null;
  end_date?: string | null;
}): MemoryEvidence {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    organization: row.organization,
    situation: row.situation,
    action: row.action,
    outcome: row.outcome,
    skills: row.skills ?? [],
    verificationStatus: row.verification_status,
    excludedFromAi: row.excluded_from_ai,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
  };
}
