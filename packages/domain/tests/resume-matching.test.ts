import { describe, expect, it } from "vitest";

import { classifyResumeTrack, rankResumes, resumeMatchSummary } from "../src/matching";

describe("resume ranking", () => {
  it("classifies Software Engineering, AI/ML, Web, Research, and General tracks", () => {
    expect(classifyResumeTrack("AI/ML Resume")).toBe("ai_ml");
    expect(classifyResumeTrack("Web Development CV")).toBe("web_development");
    expect(classifyResumeTrack("Software Engineering")).toBe("software_engineering");
    expect(classifyResumeTrack("Research statement")).toBe("research");
    expect(classifyResumeTrack("General resume")).toBe("general");
  });

  it("recommends the strongest resume and explains why", () => {
    const ranked = rankResumes("machine learning research internship pytorch", [
      { documentId: "d1", documentVersionId: "v1", label: "AI/ML Resume", type: "resume_variant" },
      { documentId: "d2", documentVersionId: "v2", label: "Web Development", type: "resume_variant" },
      { documentId: "d3", documentVersionId: "v3", label: "General resume", type: "resume" },
    ]);
    expect(ranked[0]?.track).toBe("ai_ml");
    expect(ranked[0]?.recommended).toBe(true);
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
    expect(ranked[0]?.explanation).toMatch(/AI\/ML/i);
    expect(resumeMatchSummary(ranked)).toContain("AI/ML");
  });

  it("suggests a better resume kind when none is strong and never invents experience", () => {
    const [best] = rankResumes("machine learning research residency", [
      { documentId: "d1", documentVersionId: "v1", label: "General resume", type: "resume" },
    ]);
    expect(best?.score).toBeLessThan(40);
    expect(best?.suggestion).toMatch(/do not invent/i);
    expect(best?.suggestion).toMatch(/AI\/ML|Research/i);
  });
});
