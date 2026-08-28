import { tokenize } from "./text";

export type ResumeKeywordGap = {
  term: string;
  inPosting: boolean;
  inResume: boolean;
};

export type ResumeKeywordGapResult = {
  matched: string[];
  missing: string[];
  matchRate: number;
  gaps: ResumeKeywordGap[];
};

const SKILL_HINTS = new Set([
  "python",
  "java",
  "javascript",
  "typescript",
  "react",
  "node",
  "sql",
  "aws",
  "docker",
  "kubernetes",
  "machine",
  "learning",
  "research",
  "leadership",
  "communication",
  "scholarship",
  "internship",
  "bachelor",
  "master",
  "phd",
  "gpa",
  "cnic",
]);

function distinctiveTerms(text: string): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([term, count]) => count >= 1 && (term.length >= 4 || SKILL_HINTS.has(term)))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([term]) => term)
    .slice(0, 24);
}

export function computeResumeKeywordGaps(postingText: string, resumeText: string): ResumeKeywordGapResult {
  const postingTerms = distinctiveTerms(postingText);
  const resumeTokens = new Set(tokenize(resumeText));
  const matched: string[] = [];
  const missing: string[] = [];

  for (const term of postingTerms) {
    if (resumeTokens.has(term)) matched.push(term);
    else missing.push(term);
  }

  const gaps = postingTerms.map((term) => ({
    term,
    inPosting: true,
    inResume: resumeTokens.has(term),
  }));

  const matchRate = postingTerms.length === 0 ? 0 : Math.round((matched.length / postingTerms.length) * 100);

  return { matched, missing, matchRate, gaps };
}
