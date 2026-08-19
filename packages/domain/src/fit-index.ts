import { eligibilityFactorScore } from "./eligibility";
import {
  eligibleEvidence,
  evidenceBlob,
  verifiedSkills,
  type EligibilityContext,
  type EligibilityVerdict,
  type MemoryEvidence,
} from "./intelligence-types";
import { clampScore, overlapScore } from "./text";

export const FIT_INDEX_WEIGHTS = {
  eligibility: 0.3,
  skillsMatch: 0.2,
  experienceMatch: 0.2,
  educationMatch: 0.15,
  projectRelevance: 0.15,
} as const;

export type FitFactorKey = keyof typeof FIT_INDEX_WEIGHTS;

export type FitFactor = {
  key: FitFactorKey;
  label: string;
  score: number;
  weight: number;
  contribution: number;
  rationale: string;
};

export type FitIndexInput = {
  eligibility: EligibilityVerdict[];
  evidence: MemoryEvidence[];
  opportunityText: string;
  context?: EligibilityContext;
};

export type FitIndexResult = {
  score: number;
  skillsMatch: number;
  experienceMatch: number;
  educationMatch: number;
  projectRelevance: number;
  eligibility: number;
  missing: string[];
  strengths: string[];
  factors: FitFactor[];
  weights: typeof FIT_INDEX_WEIGHTS;
  rationale: string;
};

const FACTOR_LABELS: Record<FitFactorKey, string> = {
  eligibility: "Eligibility",
  skillsMatch: "Skills Match",
  experienceMatch: "Experience Match",
  educationMatch: "Education Match",
  projectRelevance: "Project Relevance",
};

function corpusScore(opportunityText: string, corpus: string, emptyMissing: string): { score: number; rationale: string; missing: string | null; strength: string | null } {
  if (!corpus.trim()) {
    return { score: 0, rationale: emptyMissing, missing: emptyMissing, strength: null };
  }
  const score = clampScore(overlapScore(opportunityText, corpus) * 100);
  if (score >= 55) {
    return {
      score,
      rationale: `Verified memory overlaps ${score}% of distinctive opportunity terms.`,
      missing: null,
      strength: `Verified ${emptyMissing.replace("No verified ", "").replace(" in Application Memory.", "")} overlap this opportunity.`,
    };
  }
  if (score === 0) {
    return {
      score,
      rationale: "Verified memory in this category does not share distinctive terms with the posting.",
      missing: emptyMissing.replace("No verified", "Limited verified"),
      strength: null,
    };
  }
  return {
    score,
    rationale: `Partial lexical overlap (${score}%). Uncertainty is not converted into a match.`,
    missing: null,
    strength: null,
  };
}

function kindScore(
  eligibility: EligibilityVerdict[],
  kinds: string[],
  overlap: { score: number; rationale: string; missing: string | null; strength: string | null },
): { score: number; rationale: string; missing: string | null; strength: string | null } {
  const related = eligibility.filter((item) => kinds.includes(item.kind) && item.state !== "not_evaluated");
  if (related.length === 0) return overlap;
  const requirementScore = eligibilityFactorScore(related);
  const score = clampScore(requirementScore * 0.65 + overlap.score * 0.35);
  const met = related.filter((item) => item.state === "met").map((item) => item.requirementText);
  const gaps = related
    .filter((item) => item.state === "unclear" || item.state === "not_met" || item.state === "partial")
    .map((item) => item.explanation);
  return {
    score,
    rationale: `Structured ${related.length} requirement(s) scored ${requirementScore}; posting overlap ${overlap.score}. Combined ${score}.`,
    missing: gaps[0] ?? overlap.missing,
    strength: met[0] ? `Satisfied: ${met[0]}` : overlap.strength,
  };
}

export function computeFitIndex(input: FitIndexInput): FitIndexResult {
  const usable = eligibleEvidence(input.evidence);
  const eligibility = eligibilityFactorScore(input.eligibility);

  const skillsCorpus = [
    verifiedSkills(usable, input.context?.facts).join(" "),
    usable.map(evidenceBlob).join(" "),
  ].join(" ");
  const experienceCorpus = usable
    .filter((item) => item.kind === "employment" || item.kind === "leadership" || item.kind === "volunteering")
    .map(evidenceBlob)
    .join(" ");
  const educationCorpus = usable
    .filter((item) => item.kind === "education" || item.kind === "certification")
    .map(evidenceBlob)
    .join(" ");
  const projectCorpus = usable
    .filter((item) => item.kind === "project" || item.kind === "achievement" || item.kind === "research")
    .map(evidenceBlob)
    .join(" ");

  const skills = kindScore(
    input.eligibility,
    ["skill"],
    corpusScore(input.opportunityText, skillsCorpus, "No verified skills in Application Memory."),
  );
  const experience = kindScore(
    input.eligibility,
    ["experience"],
    corpusScore(input.opportunityText, experienceCorpus, "No verified professional experience in Application Memory."),
  );
  const education = kindScore(
    input.eligibility,
    ["education"],
    corpusScore(input.opportunityText, educationCorpus, "No verified education in Application Memory."),
  );
  const projects = kindScore(
    input.eligibility,
    [],
    corpusScore(input.opportunityText, projectCorpus, "No verified projects in Application Memory."),
  );

  const factorScores: Record<FitFactorKey, { score: number; rationale: string; missing: string | null; strength: string | null }> = {
    eligibility: {
      score: eligibility,
      rationale: `${input.eligibility.filter((item) => item.state === "met").length} satisfied, ${input.eligibility.filter((item) => item.state === "partial").length} partial, ${input.eligibility.filter((item) => item.state === "unclear" || item.state === "not_met").length} unknown or not satisfied. Unknown never counts as a match.`,
      missing: null,
      strength: eligibility >= 70 ? "Most extracted requirements are satisfied by verified memory." : null,
    },
    skillsMatch: skills,
    experienceMatch: experience,
    educationMatch: education,
    projectRelevance: projects,
  };

  const factors: FitFactor[] = (Object.keys(FIT_INDEX_WEIGHTS) as FitFactorKey[]).map((key) => {
    const weight = FIT_INDEX_WEIGHTS[key];
    const score = factorScores[key].score;
    return {
      key,
      label: FACTOR_LABELS[key],
      score,
      weight,
      contribution: Math.round(score * weight * 10) / 10,
      rationale: factorScores[key].rationale,
    };
  });

  const raw =
    eligibility * FIT_INDEX_WEIGHTS.eligibility +
    skills.score * FIT_INDEX_WEIGHTS.skillsMatch +
    experience.score * FIT_INDEX_WEIGHTS.experienceMatch +
    education.score * FIT_INDEX_WEIGHTS.educationMatch +
    projects.score * FIT_INDEX_WEIGHTS.projectRelevance;
  const score = clampScore(raw);

  const missing = [
    ...input.eligibility
      .filter((item) => item.state === "unclear" || item.state === "not_met" || item.state === "partial")
      .map((item) => item.explanation),
    ...factors.flatMap((factor) => {
      const gap = factorScores[factor.key].missing;
      return gap && factor.score < 55 ? [gap] : [];
    }),
  ].filter((item, index, list) => list.indexOf(item) === index);

  const strengths = factors
    .flatMap((factor) => {
      const strength = factorScores[factor.key].strength;
      return factor.score >= 55 && strength ? [strength] : [];
    })
    .filter((item, index, list) => list.indexOf(item) === index);

  const rationale = explainFitScore({
    score,
    skillsMatch: skills.score,
    experienceMatch: experience.score,
    educationMatch: education.score,
    projectRelevance: projects.score,
    eligibility,
    factors,
  });

  return {
    score,
    skillsMatch: skills.score,
    experienceMatch: experience.score,
    educationMatch: education.score,
    projectRelevance: projects.score,
    eligibility,
    missing,
    strengths,
    factors,
    weights: FIT_INDEX_WEIGHTS,
    rationale,
  };
}

export function explainFitScore(input: {
  score: number;
  eligibility: number;
  skillsMatch: number;
  experienceMatch: number;
  educationMatch: number;
  projectRelevance: number;
  factors?: FitFactor[];
}): string {
  const parts = [
    `eligibility ${input.eligibility} × ${FIT_INDEX_WEIGHTS.eligibility}`,
    `skills ${input.skillsMatch} × ${FIT_INDEX_WEIGHTS.skillsMatch}`,
    `experience ${input.experienceMatch} × ${FIT_INDEX_WEIGHTS.experienceMatch}`,
    `education ${input.educationMatch} × ${FIT_INDEX_WEIGHTS.educationMatch}`,
    `projects ${input.projectRelevance} × ${FIT_INDEX_WEIGHTS.projectRelevance}`,
  ];
  return `Fit Index is ${input.score} / 100 because ${parts.join(", ")}. Unknown requirements do not raise the score.`;
}

export function reconstructFitScore(input: {
  eligibility: number;
  skillsMatch: number;
  experienceMatch: number;
  educationMatch: number;
  projectRelevance: number;
}): number {
  return clampScore(
    input.eligibility * FIT_INDEX_WEIGHTS.eligibility +
      input.skillsMatch * FIT_INDEX_WEIGHTS.skillsMatch +
      input.experienceMatch * FIT_INDEX_WEIGHTS.experienceMatch +
      input.educationMatch * FIT_INDEX_WEIGHTS.educationMatch +
      input.projectRelevance * FIT_INDEX_WEIGHTS.projectRelevance,
  );
}
