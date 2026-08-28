import { describe, expect, it } from "vitest";

import { computeResumeKeywordGaps } from "../src/resume-keyword-gaps";

describe("computeResumeKeywordGaps", () => {
  it("flags posting terms missing from the resume", () => {
    const result = computeResumeKeywordGaps(
      "Software engineering internship requiring Python, React, and communication skills.",
      "Built projects with JavaScript and teamwork experience.",
    );
    expect(result.missing).toContain("python");
    expect(result.missing).toContain("react");
    expect(result.matchRate).toBe(0);
  });

  it("returns zero match rate when posting has no distinctive terms", () => {
    const result = computeResumeKeywordGaps("a an the", "resume text");
    expect(result.matchRate).toBe(0);
    expect(result.missing).toEqual([]);
  });
});
