import { describe, expect, it } from "vitest";

import {
  consentUpdateFields,
  onboardingHref,
  resolveOnboardingStep,
} from "@1apply/contracts";

import { mapAuthError, safeNextPath } from "@/lib/auth-errors";
import { mapExtractedEvidenceKind } from "@/lib/extraction";
import { hasConsent, onboardingComplete } from "@/lib/profile-state";
import { SEMANTIC_STATUS } from "@/lib/status";

describe("auth errors", () => {
  it("maps common Supabase failures to readable messages", () => {
    expect(mapAuthError({ message: "Invalid login credentials" })).toContain("incorrect");
    expect(mapAuthError({ code: "otp_expired" })).toContain("expired");
    expect(mapAuthError({ message: "User already registered" })).toContain("already exists");
    expect(mapAuthError({ code: "user_already_exists" })).toContain("Sign in");
    expect(mapAuthError({ message: "A user with this email address has already been registered" })).toContain(
      "already exists",
    );
  });

  it("rejects unsafe next paths", () => {
    expect(safeNextPath("/app/opportunities")).toBe("/app/opportunities");
    expect(safeNextPath("//evil.com")).toBe("/app");
    expect(safeNextPath("https://evil.com")).toBe("/app");
  });
});

describe("onboarding routing", () => {
  it("starts at consent without disclosures", () => {
    expect(
      resolveOnboardingStep({
        hasConsent: false,
        hasIdentity: false,
        documentCount: 0,
        evidenceCount: 0,
        skippedDocuments: false,
        onboardingCompleted: false,
        storedStep: "consent",
      }),
    ).toBe("consent");
  });

  it("moves to review after upload or skip", () => {
    expect(
      resolveOnboardingStep({
        hasConsent: true,
        hasIdentity: true,
        documentCount: 1,
        evidenceCount: 2,
        skippedDocuments: false,
        onboardingCompleted: false,
        storedStep: "documents",
      }),
    ).toBe("review");
  });

  it("links each step to a route", () => {
    expect(onboardingHref("profile")).toBe("/app/onboarding/profile");
    expect(onboardingHref("done")).toBe("/app");
  });

  it("stores consent without marking onboarding complete", () => {
    const fields = consentUpdateFields("2026-08-18T00:00:00.000Z");
    expect(fields.onboarding_step).toBe("profile");
    expect(fields).not.toHaveProperty("onboarding_completed_at");
  });
});

describe("profile gate helpers", () => {
  it("requires both consent timestamps", () => {
    expect(hasConsent({ terms_accepted_at: "x", ai_processing_accepted_at: null, onboarding_completed_at: null })).toBe(
      false,
    );
    expect(hasConsent({ terms_accepted_at: "x", ai_processing_accepted_at: "y", onboarding_completed_at: null })).toBe(
      true,
    );
  });

  it("treats onboarding_completed_at as workspace access", () => {
    expect(onboardingComplete({ terms_accepted_at: null, ai_processing_accepted_at: null, onboarding_completed_at: "x" })).toBe(
      true,
    );
  });
});

describe("extraction semantics", () => {
  it("maps resume kinds into experience kinds", () => {
    expect(mapExtractedEvidenceKind("work")).toBe("employment");
    expect(mapExtractedEvidenceKind("education")).toBe("education");
  });

  it("keeps AI-generated visually distinct from verified", () => {
    expect(SEMANTIC_STATUS.ai_generated.pattern).not.toBe(SEMANTIC_STATUS.verified.pattern);
  });
});
