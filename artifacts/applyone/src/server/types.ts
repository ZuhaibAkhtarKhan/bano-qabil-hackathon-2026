import type { ApplicationStatus, DocumentType, OpportunityCategory } from "@1apply/contracts";

export type ProfileDetails = {
  id: string;
  email: string;
  display_name: string | null;
  headline: string | null;
  phone: string | null;
  location_city: string | null;
  location_country: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  availability: string | null;
  work_authorization: string | null;
};

export type EvidenceRow = {
  id: string;
  title: string;
  kind: string;
  organization: string | null;
  situation: string | null;
  action: string | null;
  outcome: string | null;
  skills: string[] | null;
  source: string | null;
  source_document_id: string | null;
  source_version_id: string | null;
  source_location: string | null;
  fact_key: string | null;
  extraction_status: "manual" | "extracted" | "user_edited";
  verification_status: "unverified" | "verified" | "rejected";
  excluded_from_ai: boolean;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
};

export type ProfileFactRow = {
  id: string;
  category: string;
  fact_type: string;
  fact_key: string | null;
  value: { text?: string } | Record<string, unknown>;
  source: string | null;
  source_document_id: string | null;
  source_version_id: string | null;
  source_location: string | null;
  extraction_status: "manual" | "extracted" | "user_edited";
  verification_status: "unverified" | "verified" | "rejected";
  excerpt: string | null;
  created_at: string;
  updated_at: string;
};

export type SkillRow = {
  id: string;
  name: string;
  normalized_name: string;
  source: string | null;
  created_at: string;
};

export type ProfileLinkRow = {
  id: string;
  kind: string;
  url: string;
  label: string | null;
  created_at: string;
};

export type MemoryConflictRow = {
  id: string;
  fact_key: string;
  category: string;
  status: "open" | "resolved";
  chosen_fact_id: string | null;
  fact_ids: string[];
  values: string[];
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export type DocumentListRow = {
  id: string;
  type: DocumentType;
  label: string;
  current_version_id: string | null;
  created_at: string;
  document_versions:
    | {
        id: string;
        version_label: string;
        mime_type: string;
        byte_size: number;
        status: string;
        original_filename?: string | null;
        source?: string | null;
        storage_path?: string;
        created_at: string;
      }[]
    | null;
};

export type OpportunityListRow = {
  id: string;
  title: string;
  organization: string | null;
  category: OpportunityCategory;
  source: string;
  source_url: string | null;
  location: string | null;
  analysis_status: string;
  deadline_at: string | null;
  created_at: string;
};

export type ApplicationListRow = {
  id: string;
  opportunity_id: string;
  status: ApplicationStatus;
  deadline_at: string | null;
  next_action: string | null;
  submitted_at: string | null;
  updated_at: string;
  opportunities:
    | {
        title: string;
        organization: string | null;
        category: OpportunityCategory;
        source_url: string | null;
      }
    | {
        title: string;
        organization: string | null;
        category: OpportunityCategory;
        source_url: string | null;
      }[]
    | null;
  fit_evaluations: { score: number } | { score: number }[] | null;
};

export type NotificationRow = {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
  application_id: string | null;
  opportunity_id?: string | null;
  category?: string | null;
  priority?: number | null;
  action_url?: string | null;
  event_name?: string | null;
};

export function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}
