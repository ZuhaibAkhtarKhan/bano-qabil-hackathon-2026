export type MemoryEvidence = {
  id: string;
  title: string;
  kind: string;
  organization: string | null;
  situation: string | null;
  action: string | null;
  outcome: string | null;
  skills: string[];
  verificationStatus: "unverified" | "verified" | "rejected";
  excludedFromAi: boolean;
};

export type MemoryRequirement = {
  id: string;
  text: string;
  hard: boolean;
};

export type EligibilityVerdict = {
  requirementId: string;
  state: "met" | "not_met" | "unclear" | "not_evaluated";
  explanation: string;
  evidenceId: string | null;
};

export type FitIndexInput = {
  eligibility: EligibilityVerdict[];
  evidence: MemoryEvidence[];
  opportunityText: string;
};

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "you",
  "are",
  "was",
  "were",
  "have",
  "has",
  "been",
  "will",
  "not",
  "but",
  "or",
  "any",
  "all",
  "can",
  "must",
  "should",
  "able",
  "into",
  "onto",
]);

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+#]+/g)
    .filter((token) => token.length > 2 && !STOP.has(token));
}

export function eligibleEvidence(items: MemoryEvidence[]): MemoryEvidence[] {
  return items.filter((item) => item.verificationStatus === "verified" && !item.excludedFromAi);
}

function evidenceBlob(item: MemoryEvidence): string {
  return [item.title, item.kind, item.organization, item.situation, item.action, item.outcome, ...item.skills]
    .filter(Boolean)
    .join(" ");
}

function overlapScore(query: string, corpus: string): number {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return 0;
  const corpusTokens = new Set(tokenize(corpus));
  let hit = 0;
  for (const token of queryTokens) {
    if (corpusTokens.has(token)) hit += 1;
  }
  return hit / queryTokens.size;
}

export function evaluateRequirement(
  requirement: MemoryRequirement,
  evidence: MemoryEvidence[],
): EligibilityVerdict {
  const usable = eligibleEvidence(evidence);
  if (usable.length === 0) {
    return {
      requirementId: requirement.id,
      state: "unclear",
      explanation: "No verified evidence is available to evaluate this requirement.",
      evidenceId: null,
    };
  }

  let best: { item: MemoryEvidence; score: number } | null = null;
  for (const item of usable) {
    const score = overlapScore(requirement.text, evidenceBlob(item));
    if (!best || score > best.score) best = { item, score };
  }

  if (!best || best.score < 0.15) {
    return {
      requirementId: requirement.id,
      state: "unclear",
      explanation: "Not enough verified evidence to decide. This is not an official eligibility decision.",
      evidenceId: null,
    };
  }

  if (best.score >= 0.34) {
    return {
      requirementId: requirement.id,
      state: "met",
      explanation: `Matched verified evidence: ${best.item.title}. Assistance only — not an official decision.`,
      evidenceId: best.item.id,
    };
  }

  return {
    requirementId: requirement.id,
    state: "unclear",
    explanation: `Possible overlap with ${best.item.title}, but the requirement is not clearly evidenced.`,
    evidenceId: best.item.id,
  };
}

export function evaluateEligibility(
  requirements: MemoryRequirement[],
  evidence: MemoryEvidence[],
): EligibilityVerdict[] {
  if (requirements.length === 0) {
    return [
      {
        requirementId: "none",
        state: "not_evaluated",
        explanation: "No explicit requirements were extracted. Add them before treating this as a fit check.",
        evidenceId: null,
      },
    ];
  }
  return requirements.map((requirement) => evaluateRequirement(requirement, evidence));
}

export function computeFitIndex(input: FitIndexInput) {
  const usable = eligibleEvidence(input.evidence);
  const evaluated = input.eligibility.filter((item) => item.state !== "not_evaluated");
  const met = evaluated.filter((item) => item.state === "met").length;
  const eligibility = evaluated.length === 0 ? 0 : Math.round((met / evaluated.length) * 100);

  const skillsCorpus = usable.flatMap((item) => item.skills).join(" ");
  const experienceCorpus = usable
    .filter((item) => item.kind === "employment" || item.kind === "leadership")
    .map(evidenceBlob)
    .join(" ");
  const educationCorpus = usable
    .filter((item) => item.kind === "education" || item.kind === "certification")
    .map(evidenceBlob)
    .join(" ");
  const projectCorpus = usable
    .filter((item) => item.kind === "project" || item.kind === "achievement")
    .map(evidenceBlob)
    .join(" ");

  const skillsMatch = Math.round(overlapScore(input.opportunityText, skillsCorpus || usable.map(evidenceBlob).join(" ")) * 100);
  const experienceMatch = Math.round(overlapScore(input.opportunityText, experienceCorpus || skillsCorpus) * 100);
  const educationMatch = educationCorpus
    ? Math.round(Math.max(overlapScore(input.opportunityText, educationCorpus), eligibility / 100) * 100)
    : eligibility;
  const projectRelevance = Math.round(overlapScore(input.opportunityText, projectCorpus || skillsCorpus) * 100);

  const score = Math.round(
    eligibility * 0.3 + skillsMatch * 0.2 + experienceMatch * 0.2 + educationMatch * 0.15 + projectRelevance * 0.15,
  );

  const missing = input.eligibility
    .filter((item) => item.state === "unclear" || item.state === "not_met")
    .map((item) => item.explanation);

  return {
    score: Math.min(100, score),
    skillsMatch,
    experienceMatch,
    educationMatch,
    projectRelevance,
    eligibility,
    missing,
  };
}

export function rankEvidenceForQuestion(question: string, evidence: MemoryEvidence[], limit = 4): MemoryEvidence[] {
  return eligibleEvidence(evidence)
    .map((item) => ({ item, score: overlapScore(question, evidenceBlob(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

export type ResumeCandidate = {
  documentId: string;
  documentVersionId: string;
  label: string;
  type: string;
};

export function rankResumes(
  opportunityText: string,
  resumes: ResumeCandidate[],
): Array<ResumeCandidate & { score: number; suggestion: string | null }> {
  if (resumes.length === 0) return [];
  const ranked = resumes
    .map((resume) => ({
      ...resume,
      score: Math.round(overlapScore(opportunityText, `${resume.label} ${resume.type}`) * 100),
    }))
    .sort((a, b) => b.score - a.score);

  return ranked.map((resume, index) => ({
    ...resume,
    suggestion:
      index === 0 && resume.score < 40
        ? "Current resumes are a weak lexical match. Consider a version that highlights the evidenced projects already in memory — do not invent new ones."
        : null,
  }));
}
