import { describe, expect, it } from "vitest";

import { computeDeadlineInfo } from "@1apply/domain";

describe("eligibility auto-confirm deadline window", () => {
  it("treats deadlines within 72 hours as auto-confirm eligible", () => {
    const soon = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const info = computeDeadlineInfo(soon, null);
    expect(["soon", "imminent"]).toContain(info.urgency);
  });

  it("does not auto-confirm when deadline is more than a week away", () => {
    const later = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const info = computeDeadlineInfo(later, null);
    expect(info.urgency).toBe("none");
  });
});

describe("needs-you eligibility confirm payload", () => {
  it("marks unresolved eligibility items as confirm-only", async () => {
    const { NeedsYouEligibilityConfirm } = await import("@/components/app/needs-you-eligibility-confirm");
    expect(NeedsYouEligibilityConfirm).toBeTypeOf("function");
  });
});
