"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { opportunityCategorySchema } from "@1apply/contracts";
import { normalizeOpportunityUrl } from "@1apply/domain";

import { UnsafeUrlError } from "@/lib/security/public-url";
import { requireWorkspace } from "@/server/auth/require-workspace";
import { redirectWith } from "@/server/http/flash";
import { fetchPublicPageText } from "@/server/ingest/fetch-page";
import { runOwnedJob } from "@/infra/jobs/runner";
import { parseDiscoveryQuery, runOpportunityAnalysisJob } from "@/server/opportunities/analyze";
import { runOpportunityDiscovery } from "@/server/opportunities/discover";
import {
  createManualOpportunityRecord,
  findDuplicateOpportunity,
  ingestOpportunityPage,
  ingestPastedContent,
} from "@/server/opportunities/ingest";

function splitLines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40);
}

function parseDeadlineInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function opportunityPath(id: string) {
  return `/app/opportunities/${id}`;
}

export async function createManualOpportunity(formData: FormData) {
  const { user, supabase, actor } = await requireWorkspace();
  const title = String(formData.get("title") ?? "").trim();
  const categoryParsed = opportunityCategorySchema.safeParse(String(formData.get("category") ?? "other"));
  if (!title || !categoryParsed.success) {
    redirectWith("/app/opportunities", { error: "required" });
  }

  const { opportunityId } = await createManualOpportunityRecord({
    supabase,
    actor,
    userId: user.id,
    title,
    organization: String(formData.get("organization") ?? "").trim() || null,
    category: categoryParsed.data,
    location: String(formData.get("location") ?? "").trim() || null,
    deadlineAt: parseDeadlineInput(String(formData.get("deadline") ?? "")),
    notes: String(formData.get("notes") ?? "").trim() || null,
    requirements: splitLines(formData.get("requirements")),
    questions: splitLines(formData.get("questions")),
    documents: splitLines(formData.get("documents")),
  });

  revalidatePath("/app/opportunities");
  revalidatePath("/app/applications");
  redirectWith(opportunityPath(opportunityId), { notice: "opportunity_created" });
}

export async function ingestOpportunityUrl(formData: FormData) {
  const { user, supabase, actor } = await requireWorkspace();
  const rawUrl = String(formData.get("url") ?? "").trim();
  if (!rawUrl) redirectWith("/app/opportunities", { error: "required" });

  let page: { url: string; text: string; title: string };
  try {
    page = await fetchPublicPageText(rawUrl);
  } catch (error) {
    if (error instanceof UnsafeUrlError) redirectWith("/app/opportunities", { error: "unsafe_url" });
    redirectWith("/app/opportunities", { error: "page_fetch" });
  }

  const result = await ingestOpportunityPage({
    supabase,
    actor,
    userId: user.id,
    source: "url",
    sourceUrl: rawUrl,
    canonicalUrl: page.url,
    pageText: page.text,
    pageTitle: page.title,
  });

  revalidatePath("/app/opportunities");
  revalidatePath("/app/applications");
  redirectWith(
    opportunityPath(result.opportunityId),
    { notice: result.duplicate ? "duplicate_opportunity" : "analyzing" },
  );
}

export async function ingestPastedOpportunity(formData: FormData) {
  const { user, supabase, actor } = await requireWorkspace();
  const title = String(formData.get("title") ?? "").trim();
  const pastedText = String(formData.get("pastedText") ?? "").trim();
  if (!title || pastedText.length < 40) redirectWith("/app/opportunities", { error: "required" });

  const result = await ingestPastedContent({
    supabase,
    actor,
    userId: user.id,
    title,
    pastedText,
    sourceUrl: String(formData.get("sourceUrl") ?? "").trim() || null,
  });

  revalidatePath("/app/opportunities");
  redirectWith(opportunityPath(result.opportunityId), { notice: "analyzing" });
}

export async function reanalyzeOpportunity(formData: FormData) {
  const { user, supabase, actor } = await requireWorkspace();
  const opportunityId = String(formData.get("opportunityId") ?? "");
  const { data: opportunity } = await supabase
    .from("opportunities")
    .select("id, raw_excerpt, canonical_url, source")
    .eq("id", opportunityId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!opportunity?.raw_excerpt) redirectWith(opportunityPath(opportunityId), { error: "not_found" });

  const { data: application } = await supabase
    .from("applications")
    .select("id")
    .eq("opportunity_id", opportunityId)
    .maybeSingle();
  if (!application) redirectWith(opportunityPath(opportunityId), { error: "not_found" });

  await supabase.from("opportunities").update({ analysis_status: "pending" }).eq("id", opportunityId);

  await runOwnedJob(
    supabase,
    { actor, type: "opportunity_analyze", inputRef: opportunityId },
    async () => {
      await runOpportunityAnalysisJob({
        supabase,
        actor,
        userId: user.id,
        opportunityId,
        applicationId: application.id,
        pageText: opportunity.raw_excerpt as string,
        sourceUrl: (opportunity.canonical_url as string | null) ?? undefined,
        source: (opportunity.source as "url" | "manual" | "extension" | "discovery") ?? "url",
      });
    },
  );

  revalidatePath(opportunityPath(opportunityId));
  redirectWith(opportunityPath(opportunityId), { notice: "analyzed" });
}

export async function queueDiscoveryRequest(formData: FormData) {
  const { user, supabase, actor } = await requireWorkspace();
  const query = String(formData.get("query") ?? "").trim();
  if (query.length < 8) redirectWith("/app/opportunities", { error: "required" });

  const category = opportunityCategorySchema.safeParse(String(formData.get("filterCategory") ?? ""));
  const location = String(formData.get("filterLocation") ?? "").trim();
  const remote = String(formData.get("filterRemote") ?? "") === "on";

  const parsedFilters = await parseDiscoveryQuery(query);
  const extraFilters = {
    categories: category.success ? [category.data] : [],
    locations: location ? [location] : [],
    remoteOk: remote || parsedFilters.remoteOk,
  };

  let discoveryId = "";
  const run = async () => {
    const result = await runOpportunityDiscovery({
      supabase,
      actor,
      query,
      parsedFilters,
      extraFilters,
    });
    discoveryId = result.requestId;
  };

  try {
    await runOwnedJob(supabase, { actor, type: "opportunity_discover", inputRef: user.id }, run);
  } catch {
    if (!discoveryId) await run();
  }

  revalidatePath("/app/opportunities");
  redirect(`/app/opportunities?notice=discovery_ready&discovery=${discoveryId}#discovery`);
}

export async function saveDiscoveredOpportunity(formData: FormData) {
  const { user, supabase, actor } = await requireWorkspace();
  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim();
  const excerpt = String(formData.get("excerpt") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  if (!sourceUrl) redirectWith("/app/opportunities", { error: "required" }, "discovery");

  const canonicalUrl = normalizeOpportunityUrl(sourceUrl);
  const duplicateId = await findDuplicateOpportunity(supabase, user.id, canonicalUrl);
  if (duplicateId) {
    revalidatePath("/app/opportunities");
    redirectWith(opportunityPath(duplicateId), { notice: "duplicate_opportunity" });
  }

  let pageText = excerpt;
  let pageTitle = title || canonicalUrl;
  let fetchedUrl = canonicalUrl;
  try {
    const page = await fetchPublicPageText(sourceUrl);
    pageText = page.text || excerpt;
    pageTitle = page.title || title || pageTitle;
    fetchedUrl = page.url;
  } catch (error) {
    if (error instanceof UnsafeUrlError) redirectWith("/app/opportunities", { error: "unsafe_url" }, "discovery");
    if (!excerpt) redirectWith("/app/opportunities", { error: "page_fetch" }, "discovery");
  }

  const result = await ingestOpportunityPage({
    supabase,
    actor,
    userId: user.id,
    source: "discovery",
    sourceUrl,
    canonicalUrl: normalizeOpportunityUrl(fetchedUrl),
    pageText: pageText || `${title}\n${sourceUrl}`,
    pageTitle,
    metadata: {
      title,
      organization: String(formData.get("organization") ?? "").trim() || null,
      category: String(formData.get("category") ?? "").trim() || null,
      location: String(formData.get("location") ?? "").trim() || null,
      discovered: true,
    },
  });

  revalidatePath("/app/opportunities");
  revalidatePath("/app/applications");
  redirectWith(
    opportunityPath(result.opportunityId),
    { notice: result.duplicate ? "duplicate_opportunity" : "analyzing" },
  );
}
