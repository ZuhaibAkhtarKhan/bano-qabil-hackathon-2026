import { describe, expect, it } from "vitest";

import {
  APPLICATION_LIFECYCLE,
  assertDraftIsGrounded,
  computeProfileCompleteness,
  consentInputSchema,
  consentUpdateFields,
  groundedDraftSchema,
  jobLifecycleSchema,
  toJobLifecycle,
} from "../src/index";

describe("consent", () => {
  it("requires both disclosures", () => {
    expect(consentInputSchema.safeParse({ termsAccepted: true }).success).toBe(false);
    expect(
      consentInputSchema.safeParse({ termsAccepted: true, aiProcessingAccepted: true }).success,
    ).toBe(true);
  });
});

describe("onboarding steps", () => {
  it("does not mark onboarding complete at consent time", () => {
    const fields = consentUpdateFields("2026-08-18T00:00:00.000Z");
    expect(fields.onboarding_step).toBe("profile");
    expect(Object.keys(fields)).not.toContain("onboarding_completed_at");
  });
});

describe("profile completeness", () => {
  it("treats missing memory as incomplete, not as a fake ready state", () => {
    const empty = computeProfileCompleteness({
      displayName: null,
      hasConsent: false,
      verifiedEvidenceCount: 0,
      documentCount: 0,
    });
    expect(empty.percent).toBe(0);
    expect(empty.hasVerifiedEvidence).toBe(false);
  });

  it("counts only real signals", () => {
    const partial = computeProfileCompleteness({
      displayName: "Amina",
      hasConsent: true,
      verifiedEvidenceCount: 0,
      documentCount: 0,
    });
    expect(partial.percent).toBe(50);
    expect(partial.hasIdentity).toBe(true);
  });
});

describe("grounded drafts", () => {
  it("rejects fluent text without evidence ids", () => {
    const draft = groundedDraftSchema.parse({
      text: "I led a published research lab at CERN.",
      evidenceIds: [],
      missingFacts: ["research evidence"],
      warnings: ["NO_EVIDENCE"],
      characterCount: "I led a published research lab at CERN.".length,
    });
    expect(assertDraftIsGrounded(draft)).toContain("NO_EVIDENCE");
  });

  it("accepts text that cites evidence", () => {
    const text = "I built a retrieval pipeline for my thesis.";
    const draft = groundedDraftSchema.parse({
      text,
      evidenceIds: ["11111111-1111-4111-8111-111111111111"],
      missingFacts: [],
      warnings: [],
      characterCount: text.length,
    });
    expect(assertDraftIsGrounded(draft)).toEqual([]);
  });
});

describe("application lifecycle", () => {
  it("includes reviewable and terminal states without auto-submit", () => {
    expect(APPLICATION_LIFECYCLE).toContain("ready");
    expect(APPLICATION_LIFECYCLE).toContain("submitted");
    expect(APPLICATION_LIFECYCLE).not.toContain("auto_submitted");
  });
});

describe("job lifecycle", () => {
  it("exposes queued/processing/completed/failed without auto-submit", () => {
    expect(jobLifecycleSchema.options).toEqual(["queued", "processing", "completed", "failed"]);
    expect(toJobLifecycle("running")).toBe("processing");
    expect(toJobLifecycle("succeeded")).toBe("completed");
  });
});
