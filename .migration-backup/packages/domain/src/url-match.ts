export function normalizeOpportunityUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return trimmed.toLowerCase();
    url.hash = "";
    url.hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "";
    const dropKeys: string[] = [];
    url.searchParams.forEach((_value, key) => {
      if (/^(utm_|ref$|fbclid|gclid)/i.test(key)) dropKeys.push(key);
    });
    for (const key of dropKeys) url.searchParams.delete(key);
    const search = url.searchParams.toString();
    return `${url.protocol}//${url.host}${url.pathname}${search ? `?${search}` : ""}`;
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

/** Path-only identity used when query strings differ (Google Forms, career portals). */
function urlPathIdentity(raw: string): { host: string; path: string; formId: string | null } | null {
  try {
    const url = new URL(normalizeOpportunityUrl(raw));
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const formId = path.match(/\/forms\/d\/(?:e\/)?([^/]+)/)?.[1] ?? null;
    return { host: url.hostname, path, formId };
  } catch {
    return null;
  }
}

/**
 * Score how likely two URLs refer to the same opportunity page.
 * 1 = exact normalized match; ≥0.85 is treated as the same site for auto-select / dedupe.
 */
export function scoreUrlMatch(pageUrl: string, savedUrl: string): number {
  const a = normalizeOpportunityUrl(pageUrl);
  const b = normalizeOpportunityUrl(savedUrl);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const left = urlPathIdentity(a);
  const right = urlPathIdentity(b);
  if (!left || !right || left.host !== right.host) return 0;
  if (left.path === right.path) return 0.95;
  if (left.formId && right.formId && left.formId === right.formId) return 0.92;
  if (left.path.startsWith(`${right.path}/`) || right.path.startsWith(`${left.path}/`)) return 0.85;

  const segsA = left.path.split("/").filter(Boolean);
  const segsB = right.path.split("/").filter(Boolean);
  let shared = 0;
  while (shared < segsA.length && shared < segsB.length && segsA[shared] === segsB[shared]) shared += 1;
  if (shared >= 2 && shared === Math.min(segsA.length, segsB.length)) return 0.8;

  return 0;
}

export function urlsLikelySame(a: string, b: string): boolean {
  return scoreUrlMatch(a, b) >= 0.85;
}

export type UrlMatchableApplication = {
  id: string;
  sourceUrl?: string | null;
  canonicalUrl?: string | null;
};

/** Pick the best saved application for the open tab URL, or null if none match. */
export function matchApplicationByUrl<T extends UrlMatchableApplication>(pageUrl: string, apps: T[]): T | null {
  let best: { app: T; score: number } | null = null;
  for (const app of apps) {
    for (const candidate of [app.canonicalUrl, app.sourceUrl]) {
      if (!candidate) continue;
      const score = scoreUrlMatch(pageUrl, candidate);
      if (score >= 0.85 && (!best || score > best.score)) best = { app, score };
    }
  }
  return best?.app ?? null;
}
