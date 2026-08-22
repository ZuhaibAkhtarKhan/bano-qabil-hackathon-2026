import { eligibleEvidence, evidenceBlob, type MemoryEvidence } from "./intelligence-types";
import { overlapScore } from "./text";

export function rankEvidenceForQuestion(question: string, evidence: MemoryEvidence[], limit = 4): MemoryEvidence[] {
  return eligibleEvidence(evidence)
    .map((item) => ({ item, score: overlapScore(question, evidenceBlob(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function selectEvidenceForRequirement(requirementText: string, evidence: MemoryEvidence[]): MemoryEvidence | null {
  return rankEvidenceForQuestion(requirementText, evidence, 1)[0] ?? null;
}
