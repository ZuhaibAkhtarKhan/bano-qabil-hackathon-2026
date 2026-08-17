import { requireWorkspace } from "@/server/auth/require-workspace";

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

export async function loadDiscoveryRequests(limit = 5) {
  const { supabase } = await requireWorkspace();
  const { data } = await supabase
    .from("discovery_requests")
    .select("id, query, status, filters, result_summary, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
