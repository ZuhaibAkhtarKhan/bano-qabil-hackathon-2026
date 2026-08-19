import { describe, expect, it } from "vitest";

import { FIT_INDEX_WEIGHTS, computeFitIndex } from "../src/intelligence/fit-index";
import { evaluateEligibility } from "../src/intelligence/eligibility";
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
];

describe("fit index scoring", () => {
  it("computes a deterministic weighted score and can explain it", () => {
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

    expect(Object.values(FIT_INDEX_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(1);
    expect(fit.eligibility).toBe(50);
    expect(fit.missing.length).toBeGreaterThan(0);
    expect(fit.missingItems.some((item) => item.reason.toLowerCase().includes("availability"))).toBe(true);
    expect(fit.explanation).toContain("Eligibility");
    expect(fit.explanation).toContain("Skills Match");
    const recomputed = Math.round(fit.factors.reduce((sum, factor) => sum + factor.contribution, 0));
    expect(fit.score).toBe(recomputed);
    expect(fit.score).toBeGreaterThan(0);
    expect(fit.score).toBeLessThanOrEqual(100);
  });

  it("does not boost the score by guessing unknown requirements", () => {
    const eligibility = evaluateEligibility(
      [
        { id: "r1", text: "Python machine learning project experience", hard: false },
        { id: "r2", text: "Must be available full-time", hard: true },
      ],
      evidence,
    );
    const guessed = computeFitIndex({
      eligibility: eligibility.map((item) =>
        item.state === "needs_confirmation" ? { ...item, state: "met", displayState: "SATISFIED" } : item,
      ),
      evidence,
      opportunityText: "Python machine learning internship",
    });
    const honest = computeFitIndex({
      eligibility,
      evidence,
      opportunityText: "Python machine learning internship",
    });
    expect(honest.eligibility).toBeLessThan(guessed.eligibility);
    expect(honest.score).toBeLessThanOrEqual(guessed.score);
  });

  it("blocks apply when a hard requirement is not satisfied", () => {
    const eligibility = evaluateEligibility(
      [{ id: "r1", text: "Must be located in Zurich onsite", hard: true }],
      evidence,
      { locationCity: "Karachi", locationCountry: "Pakistan" },
    );
    const fit = computeFitIndex({
      eligibility,
      evidence,
      opportunityText: "Onsite ML internship in Zurich",
    });
    expect(fit.shouldApply).toBe("blocked");
  });
});
