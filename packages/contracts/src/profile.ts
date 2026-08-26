import { z } from "zod";

import { uuidSchema } from "./common";

export const consentInputSchema = z.object({
  termsAccepted: z.literal(true),
  aiProcessingAccepted: z.literal(true),
});

export const profileRecordSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  displayName: z.string().nullable(),
  headline: z.string().nullable(),
  termsAcceptedAt: z.string().datetime().nullable(),
  aiProcessingAcceptedAt: z.string().datetime().nullable(),
  onboardingCompletedAt: z.string().datetime().nullable(),
});

export const profileCompletenessSchema = z.object({
  hasIdentity: z.boolean(),
  hasConsent: z.boolean(),
  hasVerifiedEvidence: z.boolean(),
  hasDocument: z.boolean(),
  percent: z.number().min(0).max(100),
});

export const onboardingStepSchema = z.enum([
  "consent",
  "profile",
  "documents",
  "review",
  "ready",
  "done",
]);

export const ONBOARDING_STEPS = [
  { id: "consent", label: "Consent", href: "/app/onboarding/consent" },
  { id: "profile", label: "Profile", href: "/app/onboarding/profile" },
  { id: "documents", label: "Your kit", href: "/app/onboarding/documents" },
  { id: "review", label: "Review", href: "/app/onboarding/review" },
  { id: "ready", label: "Ready", href: "/app/onboarding/ready" },
] as const;

export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

export function consentUpdateFields(now: string) {
  return {
    terms_accepted_at: now,
    ai_processing_accepted_at: now,
    onboarding_step: "profile" as const,
  };
}

export function canFinishOnboarding(input: { hasConsent: boolean; hasIdentity: boolean }) {
  return input.hasConsent && input.hasIdentity;
}

export function resolveOnboardingStep(input: {
  hasConsent: boolean;
  hasIdentity: boolean;
  hasUniversity: boolean;
  hasEducation: boolean;
  documentCount: number;
  evidenceCount: number;
  skippedDocuments: boolean;
  onboardingCompleted: boolean;
  storedStep?: OnboardingStep | null;
}): OnboardingStep {
  if (input.onboardingCompleted) return "done";
  if (!input.hasConsent) return "consent";
  if (!input.hasIdentity || !input.hasUniversity || !input.hasEducation) return "profile";
  if (input.storedStep === "ready") return "ready";
  if (input.storedStep === "review") return "review";
  if (input.storedStep === "done") return "done";
  if (input.storedStep === "documents") return "documents";
  if (input.documentCount > 0 || input.evidenceCount > 0 || input.skippedDocuments) return "review";
  return "documents";
}

export function postAuthHref(input: {
  onboardingCompleted: boolean;
  onboardingStep: OnboardingStep;
  kitMissing: string[];
}): string {
  if (!input.onboardingCompleted) return onboardingHref(input.onboardingStep);
  if (input.kitMissing.length > 0) return "/app/memory?remind=kit";
  return "/app";
}

export function onboardingHref(step: OnboardingStep) {
  if (step === "done") return "/app";
  const match = ONBOARDING_STEPS.find((item) => item.id === step);
  return match?.href ?? "/app/onboarding/consent";
}

export type ConsentInput = z.infer<typeof consentInputSchema>;
export type ProfileRecord = z.infer<typeof profileRecordSchema>;
export type ProfileCompleteness = z.infer<typeof profileCompletenessSchema>;

export function computeProfileCompleteness(input: {
  displayName: string | null;
  hasConsent: boolean;
  verifiedEvidenceCount: number;
  documentCount: number;
}): ProfileCompleteness {
  const hasIdentity = Boolean(input.displayName?.trim());
  const hasVerifiedEvidence = input.verifiedEvidenceCount > 0;
  const hasDocument = input.documentCount > 0;
  const flags = [hasIdentity, input.hasConsent, hasVerifiedEvidence, hasDocument];
  const percent = Math.round((flags.filter(Boolean).length / flags.length) * 100);

  return {
    hasIdentity,
    hasConsent: input.hasConsent,
    hasVerifiedEvidence,
    hasDocument,
    percent,
  };
}
