export {
  eligibleEvidence,
  evidenceBlob,
  verifiedFacts,
  verifiedSkills,
  type EligibilityContext,
  type EligibilityVerdict,
  type MemoryDocument,
  type MemoryEvidence,
  type MemoryFact,
  type MemoryRequirement,
  type ResumeCandidate,
} from "./intelligence-types";

export {
  ELIGIBILITY_LABELS,
  eligibilityFactorScore,
  eligibilityLabel,
  evaluateEligibility,
  evaluateRequirement,
  inferRequirementKind,
  isPreferredRequirement,
} from "./eligibility";

export {
  FIT_INDEX_WEIGHTS,
  computeFitIndex,
  explainFitScore,
  reconstructFitScore,
  type FitFactor,
  type FitIndexInput,
  type FitIndexResult,
} from "./fit-index";

export {
  RESUME_FOCUSES,
  classifyOpportunityFocus,
  classifyResumeFocus,
  rankResumes,
  type RankedResume,
  type ResumeFocusId,
} from "./resume-matching";

export { rankEvidenceForQuestion, selectEvidenceForRequirement } from "./evidence";

export { clampScore, extractYears, overlapScore, tokenize } from "./text";
