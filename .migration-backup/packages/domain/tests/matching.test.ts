import { describe, expect, it } from "vitest";

import {
  FIT_INDEX_WEIGHTS,
  computeFitIndex,
  eligibilityLabel,
  evaluateEligibility,
  inferRequirementKind,
  rankEvidenceForQuestion,
  rankResumes,
  reconstructFitScore,
  selectEvidenceForRequirement,
  type MemoryEvidence,
} from "../src/index";

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
    endDate: "2026-06-01",
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

const education2028: MemoryEvidence = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "BS Computer Science",
  kind: "education",
  organization: "NED University",
  situation: "Bachelor of Science",
  action: null,
  outcome: "Expected graduation",
  skills: [],
  verificationStatus: "verified",
  excludedFromAi: false,
  endDate: "2028-12-01",
};

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
    expect(verdict?.label).toBe("Satisfied");
    expect(verdict?.requirementText).toContain("Python");
  });

  it("stays unclear instead of inventing a miss or a pass", () => {
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Six month full-time availability in Zurich", hard: true }],
      evidence,
    );
    expect(verdict?.state).toBe("unclear");
    expect(verdict?.label).toBe("Unknown / needs confirmation");
    expect(verdict?.needsConfirmation).toBe(true);
  });

  it("marks a conflicting graduation year as not satisfied", () => {
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Must graduate in 2027", hard: true, kind: "education" }],
      [...evidence, education2028],
    );
    expect(verdict?.state).toBe("not_met");
    expect(eligibilityLabel(verdict!.state)).toBe("Not satisfied");
  });

  it("marks a matching graduation year as satisfied", () => {
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Must graduate in 2028", hard: true, kind: "education" }],
      [...evidence, education2028],
    );
    expect(verdict?.state).toBe("met");
  });

  it("keeps a missing graduation year unknown", () => {
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Must graduate in 2027", hard: true, kind: "education" }],
      evidence,
    );
    expect(verdict?.state).toBe("unclear");
  });

  it("uses partial when a student project is related but professional experience is required", () => {
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Professional machine learning experience required", hard: true, kind: "experience" }],
      evidence,
    );
    expect(verdict?.state).toBe("partial");
    expect(verdict?.label).toBe("Partial");
  });

  it("does not treat preferred professional experience as a false miss", () => {
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Professional ML experience preferred", hard: false, kind: "experience" }],
      evidence,
    );
    expect(verdict?.state).toBe("unclear");
    expect(verdict?.explanation.toLowerCase()).toContain("preferred");
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
    expect(fit.score).toBe(
      reconstructFitScore({
        eligibility: fit.eligibility,
        skillsMatch: fit.skillsMatch,
        experienceMatch: fit.experienceMatch,
        educationMatch: fit.educationMatch,
        projectRelevance: fit.projectRelevance,
      }),
    );
    expect(fit.rationale).toContain("Fit Index is");
    expect(fit.rationale).toContain(String(fit.score));
  });

  it("keeps factor weights summing to one and explainable", () => {
    const sum = Object.values(FIT_INDEX_WEIGHTS).reduce((total, value) => total + value, 0);
    expect(sum).toBeCloseTo(1, 5);
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
    expect(best?.suggestion).toContain("weak lexical match");
    expect(best?.recommended).toBe(true);
    expect(best?.focusLabel).toBe("General");
  });

  it("ranks an AI/ML resume above a web resume and explains why", () => {
    const ranked = rankResumes("machine learning research internship python", [
      {
        documentId: "web",
        documentVersionId: "v-web",
        label: "Web Development",
        type: "resume_variant",
        text: "React Next.js frontend CSS",
      },
      {
        documentId: "ml",
        documentVersionId: "v-ml",
        label: "AI/ML",
        type: "resume_variant",
        text: "Python machine learning research classifier",
      },
    ]);
    expect(ranked[0]?.documentId).toBe("ml");
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
    expect(ranked[0]?.explanation).toContain("AI/ML");
    expect(ranked[0]?.recommended).toBe(true);
    expect(ranked[1]?.recommended).toBe(false);
  });
});

describe("requirement kind inference", () => {
  it("keeps education, location, and availability distinct", () => {
    expect(inferRequirementKind({ id: "1", text: "Bachelor degree in CS", hard: true })).toBe("education");
    expect(inferRequirementKind({ id: "2", text: "Must be available full-time", hard: true })).toBe("availability");
    expect(inferRequirementKind({ id: "3", text: "On-site in Zurich", hard: true })).toBe("location");
  });
});

describe("evidence selection", () => {
  it("selects verified evidence and ignores unverified claims", () => {
    const selected = selectEvidenceForRequirement("python machine learning", evidence);
    expect(selected?.id).toBe("11111111-1111-4111-8111-111111111111");
  });
});
