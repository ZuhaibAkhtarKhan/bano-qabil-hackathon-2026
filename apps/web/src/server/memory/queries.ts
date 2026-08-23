import type { MemoryCategory } from "@1apply/contracts";
import { categoryFromKind, memoryFactKey } from "@1apply/domain";

import type {
  ApplicationListRow,
  DocumentListRow,
  EvidenceRow,
  MemoryConflictRow,
  ProfileDetails,
  ProfileFactRow,
  ProfileLinkRow,
  SkillRow,
} from "@/server/types";
import { requireWorkspace } from "@/server/auth/require-workspace";

export async function loadMemoryWorkspace() {
  const { profile, supabase } = await requireWorkspace();

  const [
    { data: full },
    { data: evidence },
    { data: facts },
    { data: skills },
    { data: links },
    { data: conflicts },
    { data: documents },
    { data: applications },
    { count: snapshotCount },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, email, display_name, headline, phone, location_city, location_country, linkedin_url, github_url, portfolio_url, availability, work_authorization, timezone",
      )
      .eq("id", profile.id)
      .single(),
    supabase
      .from("evidence_items")
      .select(
        "id, title, kind, organization, situation, action, outcome, skills, source, source_document_id, source_version_id, source_location, fact_key, extraction_status, verification_status, excluded_from_ai, start_date, end_date, created_at, updated_at",
      )
      .order("updated_at", { ascending: false }),
    supabase
      .from("profile_facts")
      .select(
        "id, category, fact_type, fact_key, value, source, source_document_id, source_version_id, source_location, extraction_status, verification_status, excerpt, created_at, updated_at",
      )
      .order("updated_at", { ascending: false }),
    supabase.from("skills").select("id, name, normalized_name, source, created_at").order("name", { ascending: true }),
    supabase.from("profile_links").select("id, kind, url, label, created_at").order("created_at", { ascending: false }),
    supabase
      .from("memory_conflicts")
      .select("id, fact_key, category, status, chosen_fact_id, fact_ids, values, created_at, updated_at, resolved_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("documents")
      .select(
        "id, type, label, current_version_id, created_at, document_versions!document_id ( id, version_label, mime_type, byte_size, status, created_at )",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("applications")
      .select(
        "id, opportunity_id, status, deadline_at, next_action, submitted_at, updated_at, opportunities ( title, organization, category, source_url ), fit_evaluations ( score )",
      )
      .order("updated_at", { ascending: false })
      .limit(12),
    supabase.from("submission_snapshots").select("id", { count: "exact", head: true }),
  ]);

  const evidenceRows = ((evidence ?? []) as EvidenceRow[]).map((row) => ({
    ...row,
    category: categoryFromKind(row.kind),
    fact_key:
      row.fact_key ??
      memoryFactKey({
        category: categoryFromKind(row.kind),
        organization: row.organization,
        title: row.title,
        field: row.end_date ? "end_year" : "title",
      }),
  }));

  const documentById = new Map(((documents ?? []) as DocumentListRow[]).map((item) => [item.id, item]));

  return {
    profile: (full as ProfileDetails | null) ?? {
      id: profile.id,
      email: profile.email,
      display_name: profile.display_name,
      headline: profile.headline,
      phone: profile.phone,
      location_city: null,
      location_country: null,
      linkedin_url: null,
      github_url: null,
      portfolio_url: null,
      availability: null,
      work_authorization: null,
      timezone: null,
    },
    evidence: evidenceRows,
    facts: (facts ?? []) as ProfileFactRow[],
    skills: (skills ?? []) as SkillRow[],
    links: (links ?? []) as ProfileLinkRow[],
    conflicts: (conflicts ?? []) as MemoryConflictRow[],
    documents: (documents ?? []) as DocumentListRow[],
    documentById,
    applications: (applications ?? []) as ApplicationListRow[],
    snapshotCount: snapshotCount ?? 0,
  };
}

export function factsForCategory(facts: ProfileFactRow[], category: MemoryCategory) {
  return facts.filter((item) => item.category === category);
}

export function evidenceForCategory(evidence: Array<EvidenceRow & { category: MemoryCategory }>, category: MemoryCategory) {
  if (category === "skills") return [];
  if (category === "links") return [];
  if (category === "personal") return [];
  return evidence.filter((item) => item.category === category);
}
