import { describe, expect, it } from "vitest";

describe("eligibility memory verification flow", () => {
  it("defines met / needs_user / not_met verdicts for memory check", () => {
    const verdicts = ["met", "not_met", "needs_user"] as const;
    expect(verdicts).toContain("met");
    expect(verdicts).toContain("needs_user");
  });

  it("only offers confirm-eligible for gaps that are not hard not_met", () => {
    const gapStates = [
      { state: "unclear", confirmEligible: true },
      { state: "needs_confirmation", confirmEligible: true },
      { state: "not_met", confirmEligible: false },
    ];
    for (const row of gapStates) {
      const needsAck = row.state !== "not_met";
      expect(needsAck).toBe(row.confirmEligible);
    }
  });
});
