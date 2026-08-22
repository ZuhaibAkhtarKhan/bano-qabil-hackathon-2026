import { requireWorkspace } from "@/server/auth/require-workspace";
import { rankedFromRow } from "@/server/opportunities/discover";

export async function loadOpportunityDetail(opportunityId: string) {
  const { user, supabase } = await requireWorkspace();

  const { data: opportunity } = await supabase
    .from("opportunities")
    .select(
      "id, title, organization, category, location, source, source_url, canonical_url, deadline_at, raw_excerpt, analysis_status, analyzed_at, metadata, created_at, updated_at",
    )
    .eq("id", opportunityId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!opportunity) return null;

  const [{ data: requirements }, { data: questions }, { data: documents }, { data: application }] =
    await Promise.all([
      supabase
        .from("requirements")
        .select("id, text, hard, kind, confidence, source_span")
        .eq("opportunity_id", opportunityId)
        .order("created_at", { ascending: true }),
      supabase
        .from("opportunity_questions")
        .select("id, prompt, limit_value, limit_unit, sort_order, source")
        .eq("opportunity_id", opportunityId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("opportunity_documents")
        .select("id, label, required")
        .eq("opportunity_id", opportunityId)
        .order("created_at", { ascending: true }),
      supabase
        .from("applications")
        .select("id, status, deadline_at")
        .eq("opportunity_id", opportunityId)
        .maybeSingle(),
    ]);

  return {
    opportunity,
    requirements: requirements ?? [],
    questions: questions ?? [],
    documents: documents ?? [],
    application,
    metadata: (opportunity.metadata ?? {}) as {
      skills?: string[];
      experienceRequirements?: string[];
      eligibilityCriteria?: string[];
      importantDates?: Array<{ label: string; date: string | null }>;
      analysisError?: string;
    },
  };
}

export async function loadDiscoveryWorkspace(requestId?: string) {
  const { supabase } = await requireWorkspace();
  const { data: requests } = await supabase
    .from("discovery_requests")
    .select("id, query, status, filters, result_summary, created_at")
    .order("created_at", { ascending: false })
    .limit(8);

  const latest = requestId
    ? (requests ?? []).find((item) => item.id === requestId) ?? null
    : (requests ?? [])[0] ?? null;

  if (!latest) {
    return { requests: requests ?? [], active: null, results: [] as ReturnType<typeof rankedFromRow>[] };
  }

  const { data: rows } = await supabase
    .from("discovery_results")
    .select(
      "provider, source_url, canonical_url, title, organization, category, location, remote, excerpt, deadline_at, quality, rank_score, relevance, eligibility_preview, fit_preview, reasons, requirements, already_saved, opportunity_id",
    )
    .eq("request_id", latest.id)
    .order("rank_score", { ascending: false });

  return {
    requests: requests ?? [],
    active: latest,
    results: (rows ?? []).map(rankedFromRow),
  };
}
