import { opportunityCategorySchema, type OpportunityCategory } from "@1apply/contracts";
import {
  normalizeOpportunityUrl,
  type DiscoveryCandidate,
  type DiscoveryCriteria,
} from "@1apply/domain";

import { parsePublicHttpUrl } from "@/lib/security/public-url";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; 1-Apply/1.0; +https://localhost; job discovery)",
  Accept: "application/json, text/html;q=0.8",
};

function categoryFromText(text: string, fallback: OpportunityCategory): OpportunityCategory {
  const blob = text.toLowerCase();
  if (/\bintern(ship)?s?\b/.test(blob)) return "internship";
  if (/\bfellow(ship)?s?\b/.test(blob)) return "fellowship";
  if (/\bscholar(ship)?s?\b/.test(blob)) return "scholarship";
  if (/\bhackathon/.test(blob)) return "hackathon";
  if (/\bgrant/.test(blob)) return "grant";
  if (/\b(job|engineer|developer|designer|analyst|manager)\b/.test(blob)) return "job";
  return fallback;
}

function toCandidate(input: {
  provider: string;
  sourceUrl: string;
  title: string;
  organization?: string | null;
  location?: string | null;
  remote?: boolean;
  excerpt?: string;
  skills?: string[];
  category?: OpportunityCategory;
  quality?: number;
}): DiscoveryCandidate | null {
  try {
    const sourceUrl = parsePublicHttpUrl(input.sourceUrl).toString();
    const category = opportunityCategorySchema.safeParse(input.category ?? "job");
    return {
      provider: input.provider,
      sourceUrl,
      canonicalUrl: normalizeOpportunityUrl(sourceUrl),
      title: input.title.trim().slice(0, 180) || "Untitled listing",
      organization: input.organization?.trim() || null,
      category: category.success ? category.data : "other",
      location: input.location?.trim() || null,
      remote: Boolean(input.remote || /remote/i.test(input.location ?? "")),
      educationLevel: "any",
      experienceLevel: category.success && category.data === "internship" ? "internship" : "any",
      domain: [],
      skills: (input.skills ?? []).slice(0, 12),
      excerpt: (input.excerpt ?? "").replace(/\s+/g, " ").trim().slice(0, 800),
      deadlineAt: null,
      quality: input.quality ?? 55,
      requirements: [],
    };
  } catch {
    return null;
  }
}

function searchBlob(criteria: DiscoveryCriteria): string {
  return [criteria.query, ...criteria.keywords, ...criteria.skills, ...criteria.locations, ...criteria.categories]
    .join(" ")
    .toLowerCase();
}

function matchesCriteria(item: DiscoveryCandidate, criteria: DiscoveryCriteria): boolean {
  const hay = `${item.title} ${item.organization ?? ""} ${item.excerpt} ${item.location ?? ""} ${item.skills.join(" ")}`.toLowerCase();
  const tokens = searchBlob(criteria)
    .split(/[^a-z0-9+]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 2)
    .slice(0, 12);
  if (tokens.length === 0) return true;
  const hits = tokens.filter((token) => hay.includes(token)).length;
  return hits >= Math.min(2, tokens.length);
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function searchRemoteOk(criteria: DiscoveryCriteria): Promise<DiscoveryCandidate[]> {
  const rows = await fetchJson<Array<Record<string, unknown>>>("https://remoteok.com/api");
  if (!Array.isArray(rows)) return [];
  const out: DiscoveryCandidate[] = [];
  for (const row of rows.slice(0, 80)) {
    const position = String(row.position ?? row.title ?? "").trim();
    const url = String(row.url ?? row.apply_url ?? "").trim();
    if (!position || !url || !row.id) continue;
    const tags = Array.isArray(row.tags) ? row.tags.map((tag) => String(tag)) : [];
    const candidate = toCandidate({
      provider: "web_search",
      sourceUrl: url,
      title: position,
      organization: String(row.company ?? "").trim() || null,
      location: String(row.location ?? "Remote"),
      remote: true,
      excerpt: String(row.description ?? "").replace(/<[^>]+>/g, " ").slice(0, 800),
      skills: tags,
      category: categoryFromText(`${position} ${tags.join(" ")}`, "job"),
      quality: 58,
    });
    if (candidate && matchesCriteria(candidate, criteria)) out.push(candidate);
    if (out.length >= 20) break;
  }
  return out;
}

async function searchArbeitnow(criteria: DiscoveryCriteria): Promise<DiscoveryCandidate[]> {
  const payload = await fetchJson<{ data?: Array<Record<string, unknown>> }>(
    "https://www.arbeitnow.com/api/job-board-api",
  );
  const rows = payload?.data;
  if (!Array.isArray(rows)) return [];
  const out: DiscoveryCandidate[] = [];
  for (const row of rows.slice(0, 80)) {
    const title = String(row.title ?? "").trim();
    const url = String(row.url ?? "").trim();
    if (!title || !url) continue;
    const tags = Array.isArray(row.tags) ? row.tags.map((tag) => String(tag)) : [];
    const candidate = toCandidate({
      provider: "web_search",
      sourceUrl: url,
      title,
      organization: String(row.company_name ?? "").trim() || null,
      location: String(row.location ?? "").trim() || null,
      remote: Boolean(row.remote),
      excerpt: String(row.description ?? "").replace(/<[^>]+>/g, " ").slice(0, 800),
      skills: tags,
      category: categoryFromText(`${title} ${tags.join(" ")}`, "job"),
      quality: 56,
    });
    if (candidate && matchesCriteria(candidate, criteria)) out.push(candidate);
    if (out.length >= 20) break;
  }
  return out;
}

function decodeDuckDuckGoUrl(href: string): string | null {
  try {
    const parsed = new URL(href, "https://html.duckduckgo.com/html/");
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? parsePublicHttpUrl(uddg).toString() : parsePublicHttpUrl(parsed.toString()).toString();
  } catch {
    return null;
  }
}

async function searchDuckDuckGo(criteria: DiscoveryCriteria): Promise<DiscoveryCandidate[]> {
  const query = [criteria.query || criteria.keywords.join(" "), "internship OR job OR scholarship apply"]
    .filter(Boolean)
    .join(" ")
    .slice(0, 180);
  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { ...FETCH_HEADERS, Accept: "text/html" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return [];
    const html = await response.text();
    const out: DiscoveryCandidate[] = [];
    const pattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(pattern)) {
      const sourceUrl = decodeDuckDuckGoUrl(match[1] ?? "");
      const title = (match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!sourceUrl || !title) continue;
      const candidate = toCandidate({
        provider: "web_search",
        sourceUrl,
        title,
        excerpt: title,
        category: categoryFromText(title, criteria.categories[0] ?? "other"),
        quality: 50,
      });
      if (candidate) out.push(candidate);
      if (out.length >= 12) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function searchTavily(criteria: DiscoveryCriteria): Promise<DiscoveryCandidate[]> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key || key.startsWith("replace-with")) return [];
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query: `${criteria.query} internship OR job application`,
        search_depth: "basic",
        max_results: 8,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return [];
    const json = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    return (json.results ?? [])
      .map((row) =>
        toCandidate({
          provider: "web_search",
          sourceUrl: String(row.url ?? ""),
          title: String(row.title ?? ""),
          excerpt: String(row.content ?? ""),
          category: categoryFromText(`${row.title ?? ""} ${row.content ?? ""}`, "other"),
          quality: 62,
        }),
      )
      .filter((item): item is DiscoveryCandidate => Boolean(item));
  } catch {
    return [];
  }
}

export async function searchWebDiscoveryCandidates(criteria: DiscoveryCriteria): Promise<DiscoveryCandidate[]> {
  const settled = await Promise.allSettled([
    searchRemoteOk(criteria),
    searchArbeitnow(criteria),
    searchDuckDuckGo(criteria),
    searchTavily(criteria),
  ]);
  const merged: DiscoveryCandidate[] = [];
  const seen = new Set<string>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      if (seen.has(item.canonicalUrl)) continue;
      seen.add(item.canonicalUrl);
      merged.push(item);
    }
  }
  return merged.slice(0, 40);
}
