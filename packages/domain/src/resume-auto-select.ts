import { RESUME_CATEGORY_PRESETS } from "./resume-categories";
import type { ResumeCandidate } from "./intelligence-types";
import { rankResumes, type RankedResume } from "./resume-matching";

export type CategorizedResume = ResumeCandidate & {
  categoryKey?: string | null;
  categoryLabel?: string | null;
};

export type AutoResumeStrategy = "category_match" | "ai_rank" | "only_available";

export type AutoResumeSelection = {
  ranked: RankedResume[];
  strategy: AutoResumeStrategy;
  notifyUser: boolean;
  notificationTitle: string | null;
  notificationBody: string | null;
  inferredCategoryKey: string | null;
  matchedCategoryKey: string | null;
};

/** Related resume categories — used when the posting is close but not an exact preset match. */
const RELATED_CATEGORY: Record<string, string[]> = {
  software_engineering: ["full_stack", "backend", "frontend", "mern_stack", "devops"],
  frontend: ["web_development", "full_stack", "mern_stack", "ui_ux"],
  backend: ["software_engineering", "full_stack", "devops", "cloud"],
  full_stack: ["software_engineering", "frontend", "backend", "mern_stack"],
  mern_stack: ["full_stack", "frontend", "backend", "software_engineering"],
  mobile: ["software_engineering", "frontend"],
  devops: ["cloud", "software_engineering", "backend"],
  cloud: ["devops", "software_engineering"],
  data_science: ["machine_learning", "research_academia"],
  machine_learning: ["data_science", "research_academia", "software_engineering"],
  research_academia: ["machine_learning", "scholarship", "data_science"],
  scholarship: ["research_academia", "fresh_graduate"],
  fresh_graduate: ["internship", "general"],
  general: [],
};

const EXTRA_KEYWORDS: Record<string, string[]> = {
  software_engineering: ["software", "engineer", "developer", "swe", "sde", "programmer"],
  frontend: ["frontend", "front-end", "react", "vue", "angular", "css"],
  backend: ["backend", "back-end", "api", "server", "microservice"],
  full_stack: ["full stack", "fullstack"],
  mern_stack: ["mern", "mongodb", "express"],
  mobile: ["android", "ios", "mobile", "flutter", "kotlin", "swift"],
  devops: ["devops", "ci/cd", "kubernetes", "docker"],
  cloud: ["aws", "azure", "gcp", "cloud"],
  data_science: ["data scientist", "analytics", "statistics"],
  machine_learning: ["machine learning", "deep learning", "nlp", "llm", "pytorch", "tensorflow"],
  cybersecurity: ["security", "cyber", "infosec"],
  qa_testing: ["qa", "quality assurance", "test engineer"],
  ui_ux: ["ui", "ux", "design", "figma"],
  product_management: ["product manager", "pm", "product owner"],
  business_marketing: ["marketing", "business development", "sales"],
  finance_accounting: ["finance", "accounting", "audit"],
  research_academia: ["research", "phd", "thesis", "publication", "academic"],
  scholarship: ["scholarship", "fellowship", "grant"],
  fresh_graduate: ["intern", "internship", "graduate", "entry level", "junior"],
};

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function categoryKeywords(key: string, label: string): string[] {
  const fromLabel = label
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((token) => token.length > 2);
  const extra = EXTRA_KEYWORDS[key] ?? [];
  const fromKey = key.replace(/_/g, " ");
  return [...new Set([fromKey, ...fromLabel, ...extra])];
}

/** Rank preset category keys by how well they match the opportunity text. */
export function inferOpportunityCategoryKeys(opportunityText: string): Array<{ key: string; score: number }> {
  const blob = normalizeText(opportunityText);
  if (!blob) return [{ key: "general", score: 1 }];

  const scored = RESUME_CATEGORY_PRESETS.map((preset) => {
    const keywords = categoryKeywords(preset.key, preset.label);
    let score = 0;
    for (const keyword of keywords) {
      if (blob.includes(keyword)) score += keyword.includes(" ") ? 3 : 1;
    }
    if (blob.includes(preset.key.replace(/_/g, " "))) score += 4;
    return { key: preset.key, score };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [{ key: "general", score: 0 }];
  return scored;
}

function categoryMatchScore(resumeKey: string | null | undefined, inferred: Array<{ key: string; score: number }>) {
  if (!resumeKey || inferred.length === 0) return 0;
  const normalized = resumeKey.toLowerCase();
  const top = inferred[0]!;
  if (normalized === top.key) return 100 + top.score;
  if (normalized.startsWith("other_")) return 8;
  if (normalized.startsWith("legacy-")) return 4;

  for (const item of inferred.slice(0, 3)) {
    if (normalized === item.key) return 80 + item.score;
    if (RELATED_CATEGORY[item.key]?.includes(normalized)) return 55 + item.score;
    if (RELATED_CATEGORY[normalized]?.includes(item.key)) return 50 + item.score;
  }
  return 0;
}

function withRecommendation(ranked: RankedResume[], documentId: string): RankedResume[] {
  return ranked.map((item) => ({
    ...item,
    recommended: item.documentId === documentId,
  }));
}

/**
 * Pick a resume for an application:
 * 1. Match opportunity category → latest version in that category (current_version_id).
 * 2. Otherwise rank all resumes with AI/heuristics and notify the user.
 */
export function buildAutoResumeSelection(
  opportunityText: string,
  resumes: CategorizedResume[],
  options: { memoryHighlights?: string[] } = {},
): AutoResumeSelection {
  if (resumes.length === 0) {
    return {
      ranked: [],
      strategy: "only_available",
      notifyUser: false,
      notificationTitle: null,
      notificationBody: null,
      inferredCategoryKey: null,
      matchedCategoryKey: null,
    };
  }

  const inferred = inferOpportunityCategoryKeys(opportunityText);
  const inferredCategoryKey = inferred[0]?.key ?? "general";

  const categoryScored = resumes
    .map((resume) => ({
      resume,
      score: categoryMatchScore(resume.categoryKey, inferred),
    }))
    .sort((a, b) => b.score - a.score);

  const bestCategory = categoryScored[0];
  const categoryThreshold = 50;

  if (bestCategory && bestCategory.score >= categoryThreshold) {
    const picked = bestCategory.resume;
    const ranked = rankResumes(opportunityText, resumes, options);
    const reordered = withRecommendation(ranked, picked.documentId);
    const top = reordered.find((item) => item.documentId === picked.documentId)!;
    top.suggestion = `Matched ${picked.categoryLabel ?? picked.label} to this posting's ${inferredCategoryKey.replace(/_/g, " ")} focus. Using the latest version in that category.`;
    return {
      ranked: reordered,
      strategy: "category_match",
      notifyUser: false,
      notificationTitle: null,
      notificationBody: null,
      inferredCategoryKey,
      matchedCategoryKey: picked.categoryKey ?? null,
    };
  }

  if (resumes.length === 1) {
    const only = resumes[0]!;
    const ranked = withRecommendation(rankResumes(opportunityText, resumes, options), only.documentId);
    ranked[0]!.suggestion = `Only one resume is on file (${only.categoryLabel ?? only.label}). Using its latest version.`;
    return {
      ranked,
      strategy: "only_available",
      notifyUser: false,
      notificationTitle: null,
      notificationBody: null,
      inferredCategoryKey,
      matchedCategoryKey: only.categoryKey ?? null,
    };
  }

  const ranked = rankResumes(opportunityText, resumes, options);
  const best = ranked[0];
  if (!best) {
    return {
      ranked: [],
      strategy: "ai_rank",
      notifyUser: false,
      notificationTitle: null,
      notificationBody: null,
      inferredCategoryKey,
      matchedCategoryKey: null,
    };
  }

  const wanted = inferredCategoryKey.replace(/_/g, " ");
  const pickedLabel = best.label;
  best.suggestion = `No ${wanted} resume category matched strongly. AI selected ${pickedLabel} (${best.score}%) for this application.`;
  return {
    ranked,
    strategy: "ai_rank",
    notifyUser: true,
    notificationTitle: "Resume auto-selected for this application",
    notificationBody: `This posting looks like ${wanted}, but none of your resume categories matched closely. 1-Apply selected “${pickedLabel}” (${best.score}% fit). Upload or categorize a ${wanted} resume in Memory if you prefer a different version.`,
    inferredCategoryKey,
    matchedCategoryKey: resumes.find((item) => item.documentId === best.documentId)?.categoryKey ?? null,
  };
}
