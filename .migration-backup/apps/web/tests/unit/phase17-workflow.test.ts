import { describe, expect, it } from "vitest";

import { computeProfileCompleteness } from "@1apply/contracts";

import {
  allowedTransitions,
  canTransitionTo,
  computeApplicationCompleteness,
  normalizeApplicationStatus,
} from "@/lib/application-workflow";
import { nextVersionLabel } from "@/lib/documents/versioning";
import { parseDeadline } from "@/server/opportunities/analyze";

describe("document versioning", () => {
  it("increments labels and never reuses a number", () => {
    expect(nextVersionLabel([])).toBe("v1");
    expect(nextVersionLabel(["v1", "v3", "draft"])).toBe("v4");
    expect(nextVersionLabel(["V12"])).toBe("v13");
  });
});

describe("application status transitions", () => {
  it("normalizes legacy statuses onto the workspace lifecycle", () => {
    expect(normalizeApplicationStatus("draft")).toBe("saved");
    expect(normalizeApplicationStatus("preparing")).toBe("analyzing");
    expect(normalizeApplicationStatus("ready")).toBe("ready_to_apply");
  });

  it("allows analysis and submission forward, and never auto-submits from saved", () => {
    expect(canTransitionTo("saved", "analyzing")).toBe(true);
    expect(canTransitionTo("ready_to_apply", "submitted")).toBe(true);
    expect(canTransitionTo("saved", "submitted")).toBe(false);
    expect(canTransitionTo("accepted", "rejected")).toBe(false);
    expect(allowedTransitions("archived")).toEqual([]);
  });
});

describe("completeness", () => {
  it("treats empty profile memory as 0% rather than ready", () => {
    const empty = computeProfileCompleteness({
      displayName: null,
      hasConsent: false,
      verifiedEvidenceCount: 0,
      documentCount: 0,
    });
    expect(empty.percent).toBe(0);
  });

  it("is ready for submission only when resume, answers, and documents are complete", () => {
    const incomplete = computeApplicationCompleteness({
      requiredQuestions: 2,
      approvedAnswers: 1,
      requiredDocuments: ["Transcript"],
      attachedDocumentLabels: [],
      eligibilityNeedsReview: ["Availability unknown"],
      missingFitItems: ["Python experience"],
      recommendedResumeSelected: false,
      fieldMappingsPending: 2,
    });
    expect(incomplete.readyForSubmission).toBe(false);
    expect(incomplete.percent).toBeLessThan(100);

    const complete = computeApplicationCompleteness({
      requiredQuestions: 2,
      approvedAnswers: 2,
      requiredDocuments: ["Transcript"],
      attachedDocumentLabels: ["Transcript"],
      eligibilityNeedsReview: [],
      missingFitItems: [],
      recommendedResumeSelected: true,
      fieldMappingsPending: 0,
    });
    expect(complete.readyForSubmission).toBe(true);
    expect(complete.percent).toBe(100);
  });
});

describe("opportunity deadline parsing", () => {
  it("keeps invalid model dates as null instead of inventing a deadline", () => {
    expect(parseDeadline("rolling")).toBeNull();
    expect(parseDeadline("2026-09-01T00:00:00.000Z")).toBe("2026-09-01T00:00:00.000Z");
  });
});
