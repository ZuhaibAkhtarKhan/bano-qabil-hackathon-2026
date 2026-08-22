import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { eligibilityStateSchema, fitIndexSchema, resumeMatchSchema } from "@1apply/contracts";
import { ELIGIBILITY_LABELS, FIT_INDEX_WEIGHTS, reconstructFitScore } from "@1apply/domain";

import { eligibilitySemanticStatus } from "@/lib/status";

const migration = readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20260818070000_intelligence.sql"),
  "utf8",
);

describe("phase 8 contracts", () => {
  it("keeps eligibility, fit, and resume match as separate schemas", () => {
    expect(eligibilityStateSchema.options).toEqual([
      "met",
      "not_met",
      "unclear",
      "not_evaluated",
      "partial",
      "needs_confirmation",
    ]);
    expect(fitIndexSchema.parse({
      score: 87,
      skillsMatch: 90,
      experienceMatch: 80,
      educationMatch: 85,
      projectRelevance: 88,
      eligibility: 90,
      missing: ["availability not specified"],
      rationale: "Fit Index is 87 / 100 because eligibility 90 × 0.3",
    }).score).toBe(87);
    expect(
      resumeMatchSchema.parse({
        documentId: "11111111-1111-4111-8111-111111111111",
        documentVersionId: "22222222-2222-4222-8222-222222222222",
        score: 82,
        suggestion: null,
        recommended: true,
        explanation: "AI/ML scored 82 because the file overlaps machine learning terms.",
      }).score,
    ).toBe(82);
  });
});

describe("phase 8 migration", () => {
  it("stores explainable fit factors and resume explanations without collapsing systems", () => {
    expect(migration).toContain("partial");
    expect(migration).toContain("rationale");
    expect(migration).toContain("factors");
    expect(migration).toContain("recommended");
    expect(migration).toContain("three systems");
  });
});

describe("eligibility display", () => {
  it("maps stored states onto Satisfied / Not satisfied / Partial / Unknown", () => {
    expect(ELIGIBILITY_LABELS.met).toBe("Satisfied");
    expect(ELIGIBILITY_LABELS.not_met).toBe("Not satisfied");
    expect(ELIGIBILITY_LABELS.partial).toBe("Partial");
    expect(ELIGIBILITY_LABELS.unclear).toBe("Unknown / needs confirmation");
    expect(eligibilitySemanticStatus("met")).toBe("verified");
    expect(eligibilitySemanticStatus("not_met")).toBe("rejected");
    expect(eligibilitySemanticStatus("unclear")).toBe("unknown");
  });
});

describe("fit score reconstruction", () => {
  it("can answer why a score is 87 from stored factors", () => {
    const score = reconstructFitScore({
      eligibility: 90,
      skillsMatch: 90,
      experienceMatch: 80,
      educationMatch: 85,
      projectRelevance: 88,
    });
    expect(score).toBe(
      Math.round(
        90 * FIT_INDEX_WEIGHTS.eligibility +
          90 * FIT_INDEX_WEIGHTS.skillsMatch +
          80 * FIT_INDEX_WEIGHTS.experienceMatch +
          85 * FIT_INDEX_WEIGHTS.educationMatch +
          88 * FIT_INDEX_WEIGHTS.projectRelevance,
      ),
    );
  });
});
