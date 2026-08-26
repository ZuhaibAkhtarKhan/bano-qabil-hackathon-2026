import { describe, expect, it } from "vitest";

import { detectSubmissionSignals } from "../src/submission-signals";

describe("detectSubmissionSignals", () => {
  it("detects already submitted copy", () => {
    const result = detectSubmissionSignals("You have already submitted an application with this email.");
    expect(result.submitted).toBe(true);
    expect(result.matchedPattern).toBeTruthy();
  });

  it("detects response recorded copy", () => {
    const result = detectSubmissionSignals("Thank you. Your response has been recorded.");
    expect(result.submitted).toBe(true);
  });

  it("returns false for ordinary form pages", () => {
    const result = detectSubmissionSignals("Please complete all required fields before continuing.");
    expect(result.submitted).toBe(false);
  });
});
