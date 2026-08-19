import { describe, expect, it } from "vitest";

import {
  computeFitIndex,
  evaluateEligibility,
  rankEvidenceForQuestion,
  rankResumes,
  type MemoryEvidence,
} from "../src/matching";

const evidence: MemoryEvidence[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Undergraduate machine learning project",
    kind: "project",
    organization: "NED University",
    situation: "Built a retrieval pipeline",
    action: "Trained a classifier in Python",
    outcome: "Shipped a working demo",
    skills: ["python", "machine", "learning"],
    verificationStatus: "verified",
    excludedFromAi: false,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Unverified internship claim",
    kind: "employment",
    organization: "Unknown",
    situation: null,
    action: null,
    outcome: null,
    skills: ["python"],
    verificationStatus: "unverified",
    excludedFromAi: false,
  },
];

describe("eligibility", () => {
  it("does not treat unverified evidence as a match", () => {
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Professional ML internship experience required", hard: true }],
      evidence,
    );
    expect(verdict?.state).not.toBe("met");
  });

  it("marks a requirement met only from verified overlap", () => {
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Python machine learning project experience", hard: false }],
      evidence,
    );
    expect(verdict?.state).toBe("met");
    expect(verdict?.evidenceId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("stays unknown instead of inventing a miss or a pass", () => {
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Six month full-time availability in Zurich", hard: true }],
      evidence,
    );
    expect(verdict?.state).toBe("needs_confirmation");
    expect(verdict?.displayState).toBe("NEEDS CONFIRMATION");
  });
});

describe("fit index", () => {
  it("lists unclear requirements as missing rather than boosting the score with guesses", () => {
    const eligibility = evaluateEligibility(
      [
        { id: "r1", text: "Python machine learning project experience", hard: false },
        { id: "r2", text: "Six month availability in Zurich", hard: true },
      ],
      evidence,
    );
    const fit = computeFitIndex({
      eligibility,
      evidence,
      opportunityText: "Python machine learning internship",
    });
    expect(fit.missing.length).toBeGreaterThan(0);
    expect(fit.eligibility).toBe(50);
  });
});

describe("retrieval", () => {
  it("ranks verified evidence for a question", () => {
    const ranked = rankEvidenceForQuestion("Why are you interested in this machine learning internship?", evidence);
    expect(ranked[0]?.id).toBe("11111111-1111-4111-8111-111111111111");
  });
});

describe("resume matching", () => {
  it("suggests a focused version when labels barely overlap", () => {
    const [best] = rankResumes("machine learning research residency", [
      { documentId: "d1", documentVersionId: "v1", label: "General resume", type: "resume" },
    ]);
    expect(best?.suggestion?.toLowerCase()).toContain("do not invent");
  });
});
