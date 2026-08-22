import { evaluateEligibility } from "./eligibility";
import { overlapScore, roundScore } from "./text";
import {
  eligibleEvidence,
  evidenceBlob,
  type CandidateProfile,
  type EligibilityVerdict,
  type MemoryEvidence,
} from "./types";

export const FIT_INDEX_WEIGHTS = {
  eligibility: 0.3,
  skillsMatch: 0.2,
  experienceMatch: 0.2,
  educationMatch: 0.15,
  projectRelevance: 0.15,
} as const;

export type FitFactorKey = keyof typeof FIT_INDEX_WEIGHTS;

export type FitIndexInput = {
  eligibility: EligibilityVerdict[];
  evidence: MemoryEvidence[];
  opportunityText: string;
  profile?: CandidateProfile | null;
};

export type FitMissingItem = {
  requirement: string;
  reason: string;
  state: EligibilityVerdict["displayState"];
};

export type FitFactor = {
  key: FitFactorKey;
  label: string;
  score: number;
  weight: number;
  contribution: number;
  why: string;
};

export type FitIndexResult = {
  score: number;
  skillsMatch: number;
  experienceMatch: number;
  educationMatch: number;
  projectRelevance: number;
  eligibility: number;
  missing: string[];
  missingItems: FitMissingItem[];
  strengths: string[];
  factors: FitFactor[];
  explanation: string;
  shouldApply: "apply" | "consider" | "weak" | "blocked";
  shouldApplyLabel: string;
};

const FACTOR_LABEL: Record<FitFactorKey, string> = {
  eligibility: "Eligibility",
  skillsMatch: "Skills Match",
  experienceMatch: "Experience Match",
  educationMatch: "Education Match",
  projectRelevance: "Project Relevance",
};

function eligibilityScore(verdicts: EligibilityVerdict[]): { score: number; why: string } {
  const evaluated = verdicts.filter((item) => item.state !== "not_evaluated");
  if (evaluated.length === 0) {
    return { score: 0, why: "No requirements were evaluated." };
  }
  const points = evaluated.reduce((sum, item) => {
    if (item.state === "met") return sum + 1;
    if (item.state === "partial") return sum + 0.5;
    return sum;
  }, 0);
  const score = roundScore((points / evaluated.length) * 100);
  return {
    score,
    why: `${evaluated.filter((item) => item.state === "met").length} satisfied, ${evaluated.filter((item) => item.state === "partial").length} partial, ${evaluated.filter((item) => item.state === "not_met").length} not satisfied, ${evaluated.filter((item) => item.state === "unclear" || item.state === "needs_confirmation").length} unknown — unknown items are not guessed as matches.`,
  };
}

function corpusScore(query: string, corpus: string, fallback: string, whyEmpty: string): { score: number; why: string } {
  const text = corpus.trim() ? corpus : fallback;
  if (!text.trim()) return { score: 0, why: whyEmpty };
  const score = roundScore(overlapScore(query, text) * 100);
  return {
    score,
    why: corpus.trim()
      ? `Lexical overlap between the posting and verified ${whyEmpty.replace("No verified ", "").replace(" is available.", "")} evidence.`
      : `No dedicated evidence for this factor; scored from remaining verified evidence so the index stays explainable.`,
  };
}

export function computeFitIndex(input: FitIndexInput): FitIndexResult {
  const usable = eligibleEvidence(input.evidence);
  const eligibility = eligibilityScore(input.eligibility);

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
    .filter((item) => item.kind === "project" || item.kind === "achievement" || item.kind === "research")
    .map(evidenceBlob)
    .join(" ");
  const allCorpus = usable.map(evidenceBlob).join(" ");

  const skills = corpusScore(input.opportunityText, skillsCorpus || allCorpus, "", "No verified skills are available.");
  const experience = corpusScore(
    input.opportunityText,
    experienceCorpus,
    skillsCorpus,
    "No verified employment evidence is available.",
  );
  const education = educationCorpus
    ? corpusScore(input.opportunityText, educationCorpus, "", "No verified education evidence is available.")
    : { score: eligibility.score, why: "No dedicated education evidence; education factor follows eligibility so missing schooling is not invented." };
  const projects = corpusScore(
    input.opportunityText,
    projectCorpus,
    skillsCorpus,
    "No verified project evidence is available.",
  );

  const values: Record<FitFactorKey, { score: number; why: string }> = {
    eligibility,
    skillsMatch: skills,
    experienceMatch: experience,
    educationMatch: education,
    projectRelevance: projects,
  };

  const factors: FitFactor[] = (Object.keys(FIT_INDEX_WEIGHTS) as FitFactorKey[]).map((key) => {
    const weight = FIT_INDEX_WEIGHTS[key];
    const score = values[key].score;
    return {
      key,
      label: FACTOR_LABEL[key],
      score,
      weight,
      contribution: Number((score * weight).toFixed(2)),
      why: values[key].why,
    };
  });

  const raw = factors.reduce((sum, factor) => sum + factor.contribution, 0);
  const score = roundScore(raw);

  const missingItems: FitMissingItem[] = input.eligibility
    .filter((item) => item.state === "unclear" || item.state === "not_met" || item.state === "needs_confirmation" || item.state === "partial")
    .map((item) => ({
      requirement: item.requirementText,
      reason: item.explanation,
      state: item.displayState,
    }));

  const strengths = [
    ...input.eligibility.filter((item) => item.state === "met").map((item) => item.requirementText),
    ...factors.filter((factor) => factor.score >= 70).map((factor) => `${factor.label} ${factor.score}`),
  ];

  const blocked = input.eligibility.some((item) => item.hard && item.state === "not_met");
  const shouldApply: FitIndexResult["shouldApply"] = blocked
    ? "blocked"
    : score >= 75
      ? "apply"
      : score >= 50
        ? "consider"
        : "weak";
  const shouldApplyLabel =
    shouldApply === "blocked"
      ? "A hard requirement is not satisfied. Confirm before applying."
      : shouldApply === "apply"
        ? "Strong verified fit — still review missing items."
        : shouldApply === "consider"
          ? "Possible fit. Resolve unknown items before you spend time applying."
          : "Weak verified overlap. The score is low because evidence is missing, not because we invented a rejection.";

  const explanation = `${score} = ${factors.map((factor) => `${factor.label} ${factor.score}×${factor.weight}`).join(" + ")}`;

  return {
    score,
    skillsMatch: values.skillsMatch.score,
    experienceMatch: values.experienceMatch.score,
    educationMatch: values.educationMatch.score,
    projectRelevance: values.projectRelevance.score,
    eligibility: values.eligibility.score,
    missing: missingItems.map((item) => item.reason),
    missingItems,
    strengths: [...new Set(strengths)],
    factors,
    explanation,
    shouldApply,
    shouldApplyLabel,
  };
}

export function fitIndexFromRequirements(
  requirements: Parameters<typeof evaluateEligibility>[0],
  evidence: MemoryEvidence[],
  opportunityText: string,
  profile?: CandidateProfile | null,
) {
  const eligibility = evaluateEligibility(requirements, evidence, profile);
  return { eligibility, fit: computeFitIndex({ eligibility, evidence, opportunityText, profile }) };
}
