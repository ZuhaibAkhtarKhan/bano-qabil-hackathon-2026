import { describe, expect, it } from "vitest";

import {
  APPLICATION_LIFECYCLE,
  assertDraftIsGrounded,
  BatchFillRequestSchema,
  BatchFillResponseSchema,
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

describe("batch fill-plan contracts", () => {
  it("round-trips fieldId and forces need_you without a value", () => {
    const request = BatchFillRequestSchema.parse({
      applicationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      pageIndex: 2,
      fields: [{ fieldId: "f_abc", type: "textarea", label: "Why us?" }],
    });
    expect(request.fields[0]?.fieldId).toBe("f_abc");
    const response = BatchFillResponseSchema.parse({
      fields: [{ fieldId: "f_abc", status: "need_you" }],
    });
    expect(response.fields[0]?.status).toBe("need_you");
    expect(response.fields[0]?.value).toBeUndefined();
  });

  it("accepts native date field types in the batch request", () => {
    const request = BatchFillRequestSchema.parse({
      applicationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      pageIndex: 0,
      fields: [{ fieldId: "f_start", type: "date", label: "Start date" }],
    });
    expect(request.fields[0]?.type).toBe("date");
  });
});
