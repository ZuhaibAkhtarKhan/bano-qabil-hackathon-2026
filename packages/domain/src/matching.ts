export { tokenize, overlapScore, extractYears, roundScore } from "./intelligence/text";
export {
  eligibleEvidence,
  evidenceBlob,
  type CandidateProfile,
  type EligibilityDisplayState,
  type EligibilityState,
  type EligibilityVerdict,
  type MemoryEvidence,
  type MemoryRequirement,
  type RequirementKind,
  type ResumeCandidate,
  type ResumeTrack,
} from "./intelligence/types";
export {
  ELIGIBILITY_DISPLAY,
  classifyRequirementKind,
  evaluateEligibility,
  evaluateRequirement,
} from "./intelligence/eligibility";
export {
  FIT_INDEX_WEIGHTS,
  computeFitIndex,
  fitIndexFromRequirements,
  type FitFactor,
  type FitIndexInput,
  type FitIndexResult,
  type FitMissingItem,
} from "./intelligence/fit-index";
export {
  RESUME_TRACKS,
  classifyResumeTrack,
  dominantOpportunityTrack,
  rankResumes,
  resumeMatchSummary,
  type RankedResume,
} from "./intelligence/resume-matching";

import { overlapScore } from "./intelligence/text";
import { eligibleEvidence, evidenceBlob, type MemoryEvidence } from "./intelligence/types";

export function rankEvidenceForQuestion(question: string, evidence: MemoryEvidence[], limit = 4): MemoryEvidence[] {
  return eligibleEvidence(evidence)
    .map((item) => ({ item, score: overlapScore(question, evidenceBlob(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}
