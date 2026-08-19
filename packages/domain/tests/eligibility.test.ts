import { describe, expect, it } from "vitest";

import { classifyRequirementKind, evaluateEligibility } from "../src/intelligence/eligibility";
import type { MemoryEvidence } from "../src/intelligence/types";

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

describe("requirement kinds", () => {
  it("classifies education, degree, year, location, experience, skills, and availability separately", () => {
    expect(classifyRequirementKind("Bachelor's degree in Computer Science")).toBe("degree");
    expect(classifyRequirementKind("Must graduate after 2027")).toBe("graduation_year");
    expect(classifyRequirementKind("Must be available full-time in Zurich")).toBe("availability");
    expect(classifyRequirementKind("Work authorization in the United States")).toBe("location");
    expect(classifyRequirementKind("Two years of professional ML experience")).toBe("experience");
    expect(classifyRequirementKind("Skill: Python")).toBe("skills");
  });
});

describe("eligibility states", () => {
  it("does not treat unverified evidence as SATISFIED", () => {
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Professional ML internship experience required", hard: true }],
      evidence,
    );
    expect(verdict?.state).not.toBe("met");
    expect(verdict?.displayState).not.toBe("SATISFIED");
  });

  it("marks a requirement SATISFIED only from verified overlap", () => {
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Python machine learning project experience", hard: false }],
      evidence,
    );
    expect(verdict?.state).toBe("met");
    expect(verdict?.displayState).toBe("SATISFIED");
    expect(verdict?.requirementText).toContain("Python machine learning");
    expect(verdict?.evidenceId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("uses NEEDS CONFIRMATION when availability is missing instead of inventing a miss", () => {
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Six month full-time availability in Zurich", hard: true }],
      evidence,
    );
    expect(verdict?.state).toBe("needs_confirmation");
    expect(verdict?.displayState).toBe("NEEDS CONFIRMATION");
    expect(verdict?.explanation.toLowerCase()).toContain("availability not specified");
  });

  it("marks location NOT SATISFIED only when verified profile facts contradict the posting", () => {
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Must be located in Zurich onsite", hard: true }],
      evidence,
      { locationCity: "Karachi", locationCountry: "Pakistan" },
    );
    expect(verdict?.state).toBe("not_met");
    expect(verdict?.displayState).toBe("NOT SATISFIED");
  });

  it("keeps UNKNOWN when there is no verified evidence at all", () => {
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Published NLP papers", hard: false }],
      evidence.map((item) => ({ ...item, verificationStatus: "unverified" as const })),
    );
    expect(verdict?.state).toBe("unclear");
    expect(verdict?.displayState).toBe("UNKNOWN");
  });
});
