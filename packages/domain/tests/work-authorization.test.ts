import { describe, expect, it } from "vitest";

import { evaluateEligibility } from "../src/eligibility";
import {
  expandAffirmativeAuthorizationValue,
  isAffirmativeEligibilityAnswer,
  workAuthorizationMeetsRequirement,
} from "../src/work-authorization";

describe("work authorization eligibility", () => {
  it("treats Need You Yes as meeting a US work-authorization restriction", () => {
    expect(isAffirmativeEligibilityAnswer("Yes")).toBe(true);
    expect(workAuthorizationMeetsRequirement("Authorized to work in the United States", "Yes")).toBe("met");
    expect(expandAffirmativeAuthorizationValue("Yes", "Authorized to work in the United States")).toBe(
      "Yes — Authorized to work in the United States",
    );

    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Authorized to work in the United States", hard: true, kind: "location" }],
      [],
      { workAuthorization: "Yes" },
    );
    expect(verdict?.state).toBe("met");
  });

  it("does not keep asking when authorization already names the restriction", () => {
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Authorized to work in the United States", hard: true }],
      [],
      { workAuthorization: "Yes — Authorized to work in the United States" },
    );
    expect(verdict?.state).toBe("met");
  });

  it("does not treat a kit No / sponsorship-needed answer as authorized", () => {
    expect(workAuthorizationMeetsRequirement("Authorized to work in the United States", "No")).toBe("not_met");
    const [verdict] = evaluateEligibility(
      [{ id: "r1", text: "Must be authorized to work in the United States", hard: true }],
      [],
      { workAuthorization: "Requires visa sponsorship" },
    );
    expect(verdict?.state).toBe("not_met");
  });
});
