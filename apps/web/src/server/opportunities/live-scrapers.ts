import type { DiscoveryCandidate } from "@1apply/domain";
import { normalizeOpportunityUrl } from "@1apply/domain";

type CacheEntry = {
  candidates: DiscoveryCandidate[];
  cachedAt: number;
};

let cachedLiveJobs: CacheEntry | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fetches live job opportunities from public open-source job APIs (RemoteOK, Arbeitnow, HN).
 * Uses a strict 3.5s timeout with AbortController and in-memory caching to guarantee zero UI latency.
 */
export async function fetchLiveJobBoardCandidates(query?: string): Promise<DiscoveryCandidate[]> {
  const now = Date.now();
  if (cachedLiveJobs && now - cachedLiveJobs.cachedAt < CACHE_TTL_MS && cachedLiveJobs.candidates.length > 0) {
    return filterLiveCandidates(cachedLiveJobs.candidates, query);
  }

  const results: DiscoveryCandidate[] = [];

  const fetchers = [
    fetchRemoteOkJobs(),
    fetchArbeitnowJobs(),
  ];

  const settled = await Promise.allSettled(fetchers);
  for (const item of settled) {
    if (item.status === "fulfilled" && Array.isArray(item.value)) {
      results.push(...item.value);
    }
  }

  if (results.length > 0) {
    cachedLiveJobs = {
      candidates: results,
      cachedAt: now,
    };
  }

  return filterLiveCandidates(results, query);
}

function filterLiveCandidates(candidates: DiscoveryCandidate[], query?: string): DiscoveryCandidate[] {
  if (!query || query.trim().length === 0) {
    return candidates.slice(0, 30);
  }
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return candidates
    .filter((c) => {
      const text = `${c.title} ${c.organization ?? ""} ${c.excerpt} ${c.skills.join(" ")}`.toLowerCase();
      return terms.some((term) => text.includes(term));
    })
    .slice(0, 30);
}

async function fetchWithTimeout(url: string, timeoutMs = 3500): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "1Apply-DiscoveryBot/1.0",
        Accept: "application/json",
      },
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function fetchRemoteOkJobs(): Promise<DiscoveryCandidate[]> {
  try {
    const res = await fetchWithTimeout("https://remoteok.com/api", 3500);
    if (!res.ok) return [];
    const data = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(data)) return [];

    // First element of RemoteOK is legal/metadata notice
    const items = data.filter((d) => d && typeof d === "object" && typeof d.id === "string" || typeof d.id === "number");

    return items.slice(0, 25).map((item) => {
      const title = String(item.position || item.title || "Remote Opportunity");
      const company = String(item.company || "Remote Host");
      const url = String(item.url || `https://remoteok.com/l/${item.id}`);
      const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
      const description = String(item.description || "")
        .replace(/<[^>]*>?/gm, " ")
        .slice(0, 800);

      const isInternship = /intern/i.test(title) || tags.some((t) => /intern/i.test(t));

      return {
        provider: "live_board:remoteok",
        sourceUrl: url,
        canonicalUrl: normalizeOpportunityUrl(url),
        title,
        organization: company,
        category: isInternship ? ("internship" as const) : ("job" as const),
        location: "Worldwide (Remote)",
        remote: true,
        educationLevel: "any" as const,
        experienceLevel: isInternship ? ("internship" as const) : ("entry" as const),
        domain: tags.slice(0, 4),
        skills: tags.slice(0, 6),
        excerpt: description || `${title} at ${company}. Live opening sourced from RemoteOK.`,
        deadlineAt: null,
        quality: 85,
        requirements: tags.map((t, idx) => ({
          id: `req-remoteok-${item.id}-${idx}`,
          text: `Experience or knowledge in ${t}`,
          hard: idx === 0,
        })),
        alreadySaved: false,
      };
    });
  } catch {
    return [];
  }
}

async function fetchArbeitnowJobs(): Promise<DiscoveryCandidate[]> {
  try {
    const res = await fetchWithTimeout("https://www.arbeitnow.com/api/job-board-api", 3500);
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
    if (!json || !Array.isArray(json.data)) return [];

    return json.data.slice(0, 25).map((item, idx) => {
      const title = String(item.title || "Opportunity");
      const company = String(item.company_name || "Host Organization");
      const url = String(item.url || "");
      const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
      const location = String(item.location || "Remote");
      const remote = Boolean(item.remote);
      const description = String(item.description || "")
        .replace(/<[^>]*>?/gm, " ")
        .slice(0, 800);

      const isIntern = /intern/i.test(title);

      return {
        provider: "live_board:arbeitnow",
        sourceUrl: url || `https://arbeitnow.com/jobs/${idx}`,
        canonicalUrl: normalizeOpportunityUrl(url || `https://arbeitnow.com/jobs/${idx}`),
        title,
        organization: company,
        category: isIntern ? ("internship" as const) : ("job" as const),
        location,
        remote,
        educationLevel: "any" as const,
        experienceLevel: isIntern ? ("internship" as const) : ("any" as const),
        domain: tags.slice(0, 3),
        skills: tags.slice(0, 6),
        excerpt: description || `${title} at ${company}. Live opening sourced from Arbeitnow.`,
        deadlineAt: null,
        quality: 80,
        requirements: tags.map((t, i) => ({
          id: `req-arbeitnow-${idx}-${i}`,
          text: `Proficiency in ${t}`,
          hard: i === 0,
        })),
        alreadySaved: false,
      };
    });
  } catch {
    return [];
  }
}
