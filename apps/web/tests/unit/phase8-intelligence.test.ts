import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { eligibilityStateSchema, fitIndexSchema, resumeMatchSchema } from "@1apply/contracts";
import { eligibilityTone, requirementKindLabel, shouldApplyCopy } from "@/lib/intelligence";
import { mergeRequirementRows } from "@/server/opportunities/analyze";

const migration = readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20260818070000_phase8_intelligence.sql"),
  "utf8",
);

describe("phase 8 intelligence migration", () => {
  it("stores explainable fit factors and resume tracks without collapsing systems", () => {
    expect(migration).toContain("partial");
    expect(migration).toContain("needs_confirmation");
    expect(migration).toContain("explanation");
    expect(migration).toContain("should_apply");
    expect(migration).toContain("factors");
    expect(migration).toContain("track");
    expect(migration).toContain("recommended");
    expect(migration).toContain("requirement_kind");
    expect(migration).toContain("display_state");
  });
});

describe("phase 8 contracts", () => {
  it("keeps eligibility, fit, and resume match as separate schemas", () => {
    expect(eligibilityStateSchema.options).toEqual(
      expect.arrayContaining(["met", "not_met", "unclear", "partial", "needs_confirmation"]),
    );
    const fit = fitIndexSchema.parse({
      score: 87,
      skillsMatch: 90,
      experienceMatch: 80,
      educationMatch: 85,
      projectRelevance: 88,
      eligibility: 90,
      missing: ["availability not specified"],
      strengths: ["Python project"],
      explanation: "87 = Eligibility 90×0.3 + Skills Match 90×0.2",
      shouldApply: "apply",
    });
    expect(fit.score).toBe(87);
    const resume = resumeMatchSchema.parse({
      documentId: "11111111-1111-4111-8111-111111111111",
      documentVersionId: "22222222-2222-4222-8222-222222222222",
      track: "ai_ml",
      score: 82,
      explanation: "AI/ML resume scored from label only.",
      recommended: true,
      suggestion: "Use the AI/ML version.",
    });
    expect(resume.track).toBe("ai_ml");
  });
});

describe("phase 8 UI copy", () => {
  it("maps states to trustworthy labels and tones", () => {
    expect(eligibilityTone("met")).toBe("mint");
    expect(eligibilityTone("not_met")).toBe("coral");
    expect(eligibilityTone("needs_confirmation")).toBe("sand");
    expect(requirementKindLabel("graduation_year")).toBe("Graduation year");
    expect(shouldApplyCopy("blocked").tone).toBe("coral");
    expect(shouldApplyCopy("apply").label).toMatch(/strong verified fit/i);
  });
});

describe("phase 8 requirement extraction eval", () => {
  it("does not collapse extracted criteria into one AI score", () => {
    const rows = mergeRequirementRows({
      title: "Intern",
      organization: "Acme",
      category: "internship",
      location: "Remote",
      deadline: null,
      eligibilityCriteria: ["Undergraduate student", "Must graduate after 2027"],
      skills: ["Python"],
      experienceRequirements: ["1 prior internship"],
      requirements: [{ text: "Must be available full-time", hard: true, kind: "eligibility" }],
      questions: [],
      requiredDocuments: [],
      importantDates: [],
    });
    expect(rows.map((row) => row.kind)).toEqual(
      expect.arrayContaining(["availability", "graduation_year", "skills", "experience"]),
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });
});
