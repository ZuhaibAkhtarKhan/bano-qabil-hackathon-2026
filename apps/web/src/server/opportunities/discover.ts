import {
  mergeDiscoveryCriteria,
  normalizeOpportunityUrl,
  parseDiscoveryCriteria,
  runDiscoveryPipeline,
  sourcedDiscoveryCatalog,
  type DiscoveryCandidate,
  type DiscoveryCriteria,
  type RankedDiscovery,
} from "@1apply/domain";
import { discoveryFiltersSchema, opportunityCategorySchema, type DiscoveryFilters } from "@1apply/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { mapEvidence } from "@/server/memory/map-evidence";
import { searchWebDiscoveryCandidates } from "@/server/opportunities/web-search";
import type { EvidenceRow } from "@/server/types";
import { fetchLiveJobBoardCandidates } from "./live-scrapers";

function toCriteria(query: string, filters: DiscoveryFilters): DiscoveryCriteria {
  const parsed = parseDiscoveryCriteria(query);
  const education =
    filters.educationLevel === "undergraduate" || filters.educationLevel === "graduate" || filters.educationLevel === "any"
      ? filters.educationLevel
      : parsed.educationLevel;
  const experience =
    filters.experienceLevel === "internship" ||
    filters.experienceLevel === "entry" ||
    filters.experienceLevel === "mid" ||
    filters.experienceLevel === "any"
      ? filters.experienceLevel
      : parsed.experienceLevel;

  return mergeDiscoveryCriteria(parsed, {
    query,
    categories: filters.categories,
    locations: filters.locations,
    remoteOk: filters.remoteOk || parsed.remoteOk,
    educationLevel: education,
    experienceLevel: experience,
    domain: filters.domain,
    skills: filters.skills,
    otherConstraints: filters.otherConstraints,
    keywords: filters.keywords,
  });
}

function overlayFilters(criteria: DiscoveryCriteria, overlay: Partial<DiscoveryFilters>): DiscoveryCriteria {
  return mergeDiscoveryCriteria(criteria, {
    categories: overlay.categories,
    locations: overlay.locations,
    remoteOk: overlay.remoteOk,
    educationLevel:
      overlay.educationLevel === "undergraduate" || overlay.educationLevel === "graduate" || overlay.educationLevel === "any"
        ? overlay.educationLevel
        : undefined,
  });
}

async function loadWorkspaceCandidates(
  supabase: SupabaseClient,
  userId: string,
): Promise<DiscoveryCandidate[]> {
  const { data: opportunities } = await supabase
    .from("opportunities")
    .select("id, title, organization, category, location, source_url, canonical_url, deadline_at, raw_excerpt")
    .eq("user_id", userId);

  const opportunityIds = (opportunities ?? []).map((row) => row.id as string);
  const { data: requirements } = opportunityIds.length
    ? await supabase.from("requirements").select("id, opportunity_id, text, hard, kind").in("opportunity_id", opportunityIds)
    : { data: [] };

  const requirementsByOpportunity = new Map<string, Array<{ id: string; text: string; hard: boolean; kind?: string | null }>>();
  for (const row of requirements ?? []) {
    const list = requirementsByOpportunity.get(row.opportunity_id as string) ?? [];
    list.push({
      id: row.id as string,
      text: row.text as string,
      hard: Boolean(row.hard),
      kind: (row.kind as string | null) ?? null,
    });
    requirementsByOpportunity.set(row.opportunity_id as string, list);
  }

  return (opportunities ?? []).map((row) => {
    const sourceUrl = (row.canonical_url as string | null) || (row.source_url as string | null) || `manual://${row.id}`;
    const location = (row.location as string | null) ?? "";
    const category = opportunityCategorySchema.safeParse(row.category);
    return {
      provider: "workspace",
      sourceUrl,
      canonicalUrl: normalizeOpportunityUrl(sourceUrl),
      title: (row.title as string) || "Untitled opportunity",
      organization: (row.organization as string | null) ?? null,
      category: category.success ? category.data : "other",
      location: location || null,
      remote: /remote/i.test(location),
      educationLevel: "any" as const,
      experienceLevel: category.success && category.data === "internship" ? ("internship" as const) : ("any" as const),
      domain: [],
      skills: [],
      excerpt: ((row.raw_excerpt as string | null) ?? "").slice(0, 800),
      deadlineAt: (row.deadline_at as string | null) ?? null,
      quality: 60,
      requirements: requirementsByOpportunity.get(row.id as string) ?? [],
      alreadySaved: true,
      opportunityId: row.id as string,
    };
  });
}

async function loadRankContext(supabase: SupabaseClient, userId: string) {
  const [{ data: evidenceRows }, { data: profile }] = await Promise.all([
    supabase
      .from("evidence_items")
      .select(
        "id, title, kind, organization, situation, action, outcome, skills, verification_status, excluded_from_ai, start_date, end_date",
      )
      .eq("user_id", userId),
    supabase
      .from("profiles")
      .select("location_city, location_country, availability, work_authorization")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  return {
    evidence: ((evidenceRows ?? []) as EvidenceRow[]).map(mapEvidence),
    eligibilityContext: {
      locationCity: profile?.location_city as string | null | undefined,
      locationCountry: profile?.location_country as string | null | undefined,
      availability: profile?.availability as string | null | undefined,
      workAuthorization: profile?.work_authorization as string | null | undefined,
    },
    preferences: {
      locationCity: profile?.location_city as string | null | undefined,
      locationCountry: profile?.location_country as string | null | undefined,
    },
  };
}

export function serializeDiscoveryFilters(criteria: DiscoveryCriteria): DiscoveryFilters {
  return discoveryFiltersSchema.parse({
    categories: criteria.categories,
    locations: criteria.locations,
    remoteOk: criteria.remoteOk,
    educationLevel: criteria.educationLevel,
    experienceLevel: criteria.experienceLevel,
    domain: criteria.domain,
    skills: criteria.skills,
    otherConstraints: criteria.otherConstraints,
    keywords: criteria.keywords,
  });
}

export async function runOpportunityDiscovery(input: {
  supabase: SupabaseClient;
  actor: Actor;
  query: string;
  parsedFilters?: DiscoveryFilters;
  extraFilters?: Partial<DiscoveryFilters>;
}): Promise<{ requestId: string; filters: DiscoveryFilters; results: RankedDiscovery[]; summary: string }> {
  const { supabase, actor, query } = input;
  const base = toCriteria(query, input.parsedFilters ?? serializeDiscoveryFilters(parseDiscoveryCriteria(query)));
  const criteria = overlayFilters(base, input.extraFilters ?? {});
  const filters = serializeDiscoveryFilters(criteria);

  const { data: request, error } = await supabase
    .from("discovery_requests")
    .insert({
      user_id: actor.userId,
      query,
      status: "processing",
      filters,
    })
    .select("id")
    .single();

  if (error || !request) throw new Error("DISCOVERY_REQUEST_FAILED");

  try {
    const [workspace, web, context, liveBoardJobs] = await Promise.all([
      loadWorkspaceCandidates(supabase, actor.userId),
      searchWebDiscoveryCandidates(criteria).catch(() => [] as DiscoveryCandidate[]),
      loadRankContext(supabase, actor.userId),
      fetchLiveJobBoardCandidates(query),
    ]);
    const candidates = [...sourcedDiscoveryCatalog(), ...web, ...workspace, ...liveBoardJobs];
    const ranked = runDiscoveryPipeline(candidates, criteria, context);

    if (ranked.length > 0) {
      await supabase.from("discovery_results").insert(
        ranked.map((item) => ({
          user_id: actor.userId,
          request_id: request.id,
          provider: item.provider,
          source_url: item.sourceUrl,
          canonical_url: item.canonicalUrl,
          title: item.title,
          organization: item.organization,
          category: item.category,
          location: item.location,
          remote: item.remote,
          excerpt: item.excerpt,
          deadline_at: item.deadlineAt,
          quality: item.quality,
          rank_score: item.rank,
          relevance: item.relevance,
          eligibility_preview: item.eligibilityPreview,
          fit_preview: item.fitPreview,
          reasons: item.reasons,
          requirements: item.requirements,
          already_saved: Boolean(item.alreadySaved),
          opportunity_id: item.opportunityId ?? null,
        })),
      );
    }

    const summary = ranked.length
      ? `Ranked ${ranked.length} live and sourced listing${ranked.length === 1 ? "" : "s"} from the public web, program pages, and your saved opportunities. Fit Index is a preview from verified memory only.`
      : "No live or sourced listings matched those filters. Broaden location or type, or paste a posting URL.";

    await supabase
      .from("discovery_requests")
      .update({ status: "completed", result_summary: summary, completed_at: new Date().toISOString(), filters })
      .eq("id", request.id);

    return { requestId: request.id as string, filters, results: ranked, summary };
  } catch (err) {
    await supabase
      .from("discovery_requests")
      .update({
        status: "failed",
        result_summary: err instanceof Error ? err.message : "Discovery failed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", request.id);
    throw err;
  }
}

export function rankedFromRow(row: {
  provider: string;
  source_url: string;
  canonical_url: string;
  title: string;
  organization: string | null;
  category: string;
  location: string | null;
  remote: boolean;
  excerpt: string;
  deadline_at: string | null;
  quality: number;
  rank_score: number;
  relevance: number;
  eligibility_preview: number | null;
  fit_preview: number | null;
  reasons: unknown;
  requirements: unknown;
  already_saved: boolean;
  opportunity_id: string | null;
}): RankedDiscovery {
  const category = opportunityCategorySchema.safeParse(row.category);
  return {
    provider: row.provider,
    sourceUrl: row.source_url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    organization: row.organization,
    category: category.success ? category.data : "other",
    location: row.location,
    remote: row.remote,
    educationLevel: "any",
    experienceLevel: "any",
    domain: [],
    skills: [],
    excerpt: row.excerpt,
    deadlineAt: row.deadline_at,
    quality: row.quality,
    requirements: Array.isArray(row.requirements) ? (row.requirements as RankedDiscovery["requirements"]) : [],
    alreadySaved: row.already_saved,
    opportunityId: row.opportunity_id ?? undefined,
    rank: row.rank_score,
    relevance: row.relevance,
    eligibilityPreview: row.eligibility_preview,
    fitPreview: row.fit_preview,
    deadlineScore: 0,
    preferenceScore: 0,
    reasons: Array.isArray(row.reasons) ? (row.reasons as string[]) : [],
  };
}
