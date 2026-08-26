import { describe, expect, it } from "vitest";

import { currentGuideStep, nextGuideSteps } from "../src/guide";

describe("workspace guide", () => {
  it("sends an incomplete kit to Your kit first", () => {
    const steps = nextGuideSteps({
      kitMissing: ["university", "CNIC"],
      opportunityCount: 0,
      applicationCount: 0,
      needsYouCount: 0,
      prepareAndSendIfSilent: false,
    });
    expect(currentGuideStep(steps)?.id).toBe("kit");
    expect(currentGuideStep(steps)?.href).toBe("/app/memory");
    expect(steps.map((step) => step.id)).toContain("posting");
  });

  it("sends a complete kit with no posting to add a posting", () => {
    const steps = nextGuideSteps({
      kitMissing: [],
      opportunityCount: 0,
      applicationCount: 0,
      needsYouCount: 0,
      prepareAndSendIfSilent: false,
    });
    expect(currentGuideStep(steps)).toMatchObject({ id: "posting", href: "/app/opportunities" });
  });

  it("points at Need You when packets need the user", () => {
    const steps = nextGuideSteps({
      kitMissing: [],
      opportunityCount: 1,
      applicationCount: 2,
      needsYouCount: 2,
      prepareAndSendIfSilent: true,
    });
    expect(currentGuideStep(steps)).toMatchObject({ id: "packet", href: "/app/needs-you" });
    expect(steps.some((step) => step.id === "settings")).toBe(false);
  });
});
