import type { OpportunityCategory } from "@1apply/contracts";

import { computeDeadlineInfo } from "./deadline-intelligence";
import { eligibilityFactorScore, evaluateEligibility } from "./eligibility";
import { computeFitIndex } from "./fit-index";
import type { EligibilityContext, MemoryEvidence, MemoryRequirement } from "./intelligence-types";
import { clampScore, overlapScore, tokenize } from "./text";

export type ExperienceLevel = "internship" | "entry" | "mid" | "any";
export type EducationLevel = "undergraduate" | "graduate" | "any";

export type DiscoveryCriteria = {
  query: string;
  categories: OpportunityCategory[];
  domain: string[];
  skills: string[];
  locations: string[];
  remoteOk: boolean;
  educationLevel: EducationLevel | null;
  experienceLevel: ExperienceLevel | null;
  otherConstraints: string[];
  keywords: string[];
};

export type DiscoveryCandidate = {
  provider: string;
  sourceUrl: string;
  canonicalUrl: string;
  title: string;
  organization: string | null;
  category: OpportunityCategory;
  location: string | null;
  remote: boolean;
  educationLevel: EducationLevel;
  experienceLevel: ExperienceLevel;
  domain: string[];
  skills: string[];
  excerpt: string;
  deadlineAt: string | null;
  quality: number;
  requirements: MemoryRequirement[];
  alreadySaved?: boolean;
  opportunityId?: string;
};

export type RankedDiscovery = DiscoveryCandidate & {
  rank: number;
  relevance: number;
  eligibilityPreview: number | null;
  fitPreview: number | null;
  deadlineScore: number;
  preferenceScore: number;
  reasons: string[];
};

export type DiscoveryPreferences = {
  locationCity?: string | null;
  locationCountry?: string | null;
};

const CATEGORY_ALIASES: Array<{ match: RegExp; category: OpportunityCategory }> = [
  { match: /\bintern(ship|ships)?\b/, category: "internship" },
  { match: /\bfellow(ship|ships)?\b/, category: "fellowship" },
  { match: /\bscholar(ship|ships)?\b/, category: "scholarship" },
  { match: /\bhackathon(s)?\b/, category: "hackathon" },
  { match: /\bgrant(s)?\b/, category: "grant" },
  { match: /\b(job|jobs|full[- ]time|role)\b/, category: "job" },
  { match: /\buniversity|college|admission/, category: "university" },
  { match: /\baccelerator/, category: "accelerator" },
  { match: /\bconference/, category: "conference" },
];

const DOMAIN_ALIASES: Array<{ match: RegExp; domain: string }> = [
  { match: /\bai\b|artificial intelligence|machine learning|\bml\b|deep learning/, domain: "ai_ml" },
  { match: /\bweb\b|frontend|react|next\.js/, domain: "web" },
  { match: /\bresearch\b/, domain: "research" },
  { match: /\bdata\b|analytics/, domain: "data" },
  { match: /\bsoftware|swe|developer/, domain: "software" },
];

const SKILL_ALIASES = ["python", "pytorch", "tensorflow", "javascript", "typescript", "react", "sql", "nlp"];

export function emptyDiscoveryCriteria(query = ""): DiscoveryCriteria {
  return {
    query,
    categories: [],
    domain: [],
    skills: [],
    locations: [],
    remoteOk: false,
    educationLevel: null,
    experienceLevel: null,
    otherConstraints: [],
    keywords: [],
  };
}

export function parseDiscoveryCriteria(query: string): DiscoveryCriteria {
  const text = query.trim();
  const lower = text.toLowerCase();
  const criteria = emptyDiscoveryCriteria(text);

  for (const alias of CATEGORY_ALIASES) {
    if (alias.match.test(lower) && !criteria.categories.includes(alias.category)) {
      criteria.categories.push(alias.category);
    }
  }
  for (const alias of DOMAIN_ALIASES) {
    if (alias.match.test(lower) && !criteria.domain.includes(alias.domain)) {
      criteria.domain.push(alias.domain);
    }
  }
  for (const skill of SKILL_ALIASES) {
    if (new RegExp(`\\b${skill}\\b`, "i").test(lower)) criteria.skills.push(skill);
  }

  if (/\bremote\b/.test(lower)) criteria.remoteOk = true;
  if (/\bpakistan\b|\bkarachi\b|\blahore\b|\bislamabad\b/.test(lower)) {
    if (/\bpakistan\b/.test(lower)) criteria.locations.push("Pakistan");
    if (/\bkarachi\b/.test(lower)) criteria.locations.push("Karachi");
    if (/\blahore\b/.test(lower)) criteria.locations.push("Lahore");
    if (/\bislamabad\b/.test(lower)) criteria.locations.push("Islamabad");
  }
  if (/\bundergrad|undergraduate|bachelor/.test(lower)) criteria.educationLevel = "undergraduate";
  else if (/\bgraduate student|master'?s|phd\b/.test(lower)) criteria.educationLevel = "graduate";

  if (criteria.categories.includes("internship")) criteria.experienceLevel = "internship";
  else if (/\bentry[- ]level|junior\b/.test(lower)) criteria.experienceLevel = "entry";
  else if (/\bmid[- ]level|senior\b/.test(lower)) criteria.experienceLevel = "mid";

  if (/\bvisa\b/.test(lower)) criteria.otherConstraints.push("visa");
  if (/\bfull[- ]time\b/.test(lower)) criteria.otherConstraints.push("full-time");
  if (/\bpart[- ]time\b/.test(lower)) criteria.otherConstraints.push("part-time");

  criteria.keywords = tokenize(text).slice(0, 16);
  return criteria;
}

export function mergeDiscoveryCriteria(base: DiscoveryCriteria, overlay: Partial<DiscoveryCriteria>): DiscoveryCriteria {
  return {
    query: overlay.query ?? base.query,
    categories: overlay.categories?.length ? overlay.categories : base.categories,
    domain: overlay.domain?.length ? overlay.domain : base.domain,
    skills: overlay.skills?.length ? overlay.skills : base.skills,
    locations: overlay.locations?.length ? overlay.locations : base.locations,
    remoteOk: overlay.remoteOk ?? base.remoteOk,
    educationLevel: overlay.educationLevel ?? base.educationLevel,
    experienceLevel: overlay.experienceLevel ?? base.experienceLevel,
    otherConstraints: overlay.otherConstraints?.length ? overlay.otherConstraints : base.otherConstraints,
    keywords: overlay.keywords?.length ? overlay.keywords : base.keywords,
  };
}

export function normalizeOpportunityUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return trimmed.toLowerCase();
    url.hash = "";
    url.hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    const search = url.searchParams.toString();
    return `${url.protocol}//${url.host}${url.pathname}${search ? `?${search}` : ""}`;
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

export function discoveryIdentity(item: Pick<DiscoveryCandidate, "canonicalUrl" | "title" | "organization">): string {
  if (item.canonicalUrl) return item.canonicalUrl;
  return [item.organization, item.title].filter(Boolean).join("|").toLowerCase();
}

export function deduplicateDiscoveries(items: DiscoveryCandidate[]): DiscoveryCandidate[] {
  const seen = new Map<string, DiscoveryCandidate>();
  for (const item of items) {
    const canonicalUrl = normalizeOpportunityUrl(item.sourceUrl || item.canonicalUrl);
    const normalized = { ...item, canonicalUrl, sourceUrl: item.sourceUrl || canonicalUrl };
    const key = discoveryIdentity(normalized);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, normalized);
      continue;
    }
    const preferSaved = normalized.alreadySaved && !existing.alreadySaved;
    const preferQuality = normalized.quality > existing.quality;
    if (preferSaved || (!existing.alreadySaved && preferQuality)) seen.set(key, normalized);
  }
  return [...seen.values()];
}

function listingBlob(item: DiscoveryCandidate): string {
  return [
    item.title,
    item.organization,
    item.category,
    item.location,
    item.excerpt,
    item.domain.join(" "),
    item.skills.join(" "),
    item.educationLevel,
  ].join(" ");
}

function locationMatches(item: DiscoveryCandidate, criteria: DiscoveryCriteria): boolean {
  if (criteria.locations.length === 0) return true;
  if (criteria.remoteOk && item.remote) return true;
  const haystack = `${item.location ?? ""} ${item.remote ? "remote" : ""}`.toLowerCase();
  return criteria.locations.some((location) => haystack.includes(location.toLowerCase()));
}

export function filterDiscoveries(items: DiscoveryCandidate[], criteria: DiscoveryCriteria): DiscoveryCandidate[] {
  return items.filter((item) => {
    if (criteria.categories.length > 0 && !criteria.categories.includes(item.category)) return false;
    if (!locationMatches(item, criteria)) return false;
    if (criteria.educationLevel && criteria.educationLevel !== "any" && item.educationLevel !== "any") {
      if (item.educationLevel !== criteria.educationLevel) return false;
    }
    if (criteria.experienceLevel && criteria.experienceLevel !== "any" && item.experienceLevel !== "any") {
      if (item.experienceLevel !== criteria.experienceLevel) return false;
    }
    return true;
  });
}

function relevanceScore(item: DiscoveryCandidate, criteria: DiscoveryCriteria): number {
  const target = [
    criteria.query,
    ...criteria.domain,
    ...criteria.skills,
    ...criteria.keywords,
    ...criteria.categories,
  ].join(" ");
  return clampScore(overlapScore(target, listingBlob(item)) * 100);
}

function deadlineScore(deadlineAt: string | null, now: Date): number {
  const info = computeDeadlineInfo(deadlineAt, null, now);
  if (info.urgency === "overdue") return 0;
  if (info.urgency === "imminent") return 95;
  if (info.urgency === "soon") return 85;
  if (info.urgency === "upcoming") return 70;
  if (deadlineAt) return 55;
  return 40;
}

function preferenceScore(item: DiscoveryCandidate, criteria: DiscoveryCriteria, preferences?: DiscoveryPreferences): number {
  let score = 50;
  if (criteria.remoteOk && item.remote) score += 20;
  if (locationMatches(item, criteria)) score += 10;
  const home = [preferences?.locationCity, preferences?.locationCountry].filter(Boolean).join(" ").toLowerCase();
  if (home && (item.location ?? "").toLowerCase().includes(home.split(" ")[0] ?? "___")) score += 10;
  if (criteria.domain.some((domain) => item.domain.includes(domain) || listingBlob(item).toLowerCase().includes(domain.replace("_", " ")))) {
    score += 10;
  }
  return clampScore(score);
}

export function rankDiscoveries(
  items: DiscoveryCandidate[],
  criteria: DiscoveryCriteria,
  context: {
    evidence?: MemoryEvidence[];
    eligibilityContext?: EligibilityContext;
    preferences?: DiscoveryPreferences;
    now?: Date;
  } = {},
): RankedDiscovery[] {
  const evidence = context.evidence ?? [];
  const now = context.now ?? new Date();
  const hasEvidence = evidence.some((item) => item.verificationStatus === "verified" && !item.excludedFromAi);

  const ranked = items.map((item) => {
    const relevance = relevanceScore(item, criteria);
    const preference = preferenceScore(item, criteria, context.preferences);
    const deadline = deadlineScore(item.deadlineAt, now);
    let eligibilityPreview: number | null = null;
    let fitPreview: number | null = null;
    const reasons: string[] = [];

    if (hasEvidence && item.requirements.length > 0) {
      const eligibility = evaluateEligibility(item.requirements, evidence, context.eligibilityContext);
      eligibilityPreview = eligibilityFactorScore(eligibility);
      fitPreview = computeFitIndex({
        eligibility,
        evidence,
        opportunityText: listingBlob(item),
        context: context.eligibilityContext,
      }).score;
      reasons.push(`Eligibility preview ${eligibilityPreview} from verified memory only.`);
    } else if (!hasEvidence) {
      reasons.push("Fit Index preview unavailable — no verified evidence in Application Memory.");
    } else {
      reasons.push("No structured requirements on the source listing; eligibility was not guessed.");
    }

    if (item.remote && criteria.remoteOk) reasons.push("Matches remote preference.");
    if (item.alreadySaved) reasons.push("Already saved in your workspace.");
    reasons.push(`Source retained: ${item.sourceUrl}`);

    const rank = clampScore(
      (eligibilityPreview ?? 35) * 0.25 +
        (fitPreview ?? 35) * 0.25 +
        relevance * 0.2 +
        deadline * 0.15 +
        preference * 0.1 +
        item.quality * 0.05,
    );

    return {
      ...item,
      rank,
      relevance,
      eligibilityPreview,
      fitPreview,
      deadlineScore: deadline,
      preferenceScore: preference,
      reasons,
    };
  });

  return ranked.sort((a, b) => b.rank - a.rank || b.relevance - a.relevance || a.title.localeCompare(b.title));
}

export function runDiscoveryPipeline(
  items: DiscoveryCandidate[],
  criteria: DiscoveryCriteria,
  context?: Parameters<typeof rankDiscoveries>[2],
): RankedDiscovery[] {
  return rankDiscoveries(filterDiscoveries(deduplicateDiscoveries(items), criteria), criteria, context);
}
