import { describe, expect, it } from "vitest";

import { classifyRequirementKind, evaluateEligibility } from "../src/intelligence/eligibility";
import { rankEvidenceForQuestion } from "../src/matching";
import type { MemoryEvidence } from "../src/intelligence/types";

/**
 * AI evaluation fixtures. These lock expected structured outcomes for
 * requirement extraction, semantic matching, and evidence selection without
 * calling a live model so CI stays deterministic.
 */
const extractedCriteria = [
  "Undergraduate student",
  "Must graduate after 2027",
  "Skill: Python",
  "Prior machine learning project",
  "Must be available full-time",
];

const evidence: MemoryEvidence[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Undergraduate machine learning project",
    kind: "project",
    organization: "NED University",
    situation: "Built a retrieval pipeline",
    action: "Trained a classifier in Python",
    outcome: "Shipped a working demo",
    skills: ["python", "pytorch", "machine", "learning"],
    verificationStatus: "verified",
    excludedFromAi: false,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Campus web club",
    kind: "leadership",
    organization: "NED",
    situation: "Organized a hackathon",
    action: "Coordinated volunteers",
    outcome: "200 attendees",
    skills: ["leadership"],
    verificationStatus: "verified",
    excludedFromAi: false,
  },
];

describe("AI evaluation: requirement extraction", () => {
  it("classifies each extracted criterion without collapsing them into one score", () => {
    expect(extractedCriteria.map((text) => classifyRequirementKind(text))).toEqual([
      "degree",
      "graduation_year",
      "skills",
      "experience",
      "availability",
    ]);
  });
});

describe("AI evaluation: semantic matching", () => {
  it("selects the verified ML project for an ML requirement and does not invent a match", () => {
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Prior machine learning project in Python", hard: false }],
      evidence,
    );
    expect(verdict?.evidenceId).toBe("11111111-1111-4111-8111-111111111111");
    expect(verdict?.state).toBe("met");
  });
});

describe("AI evaluation: evidence selection", () => {
  it("ranks the ML project first for an ML internship question", () => {
    const ranked = rankEvidenceForQuestion(
      "Why are you interested in this machine learning internship?",
      evidence,
    );
    expect(ranked[0]?.id).toBe("11111111-1111-4111-8111-111111111111");
  });
});
