import type { OnboardingStep } from "@1apply/contracts";

export type ProfileGateRow = {
  terms_accepted_at: string | null;
  ai_processing_accepted_at: string | null;
  onboarding_completed_at: string | null;
  onboarding_step?: OnboardingStep | string | null;
  preferences?: Record<string, unknown> | null;
};

export function hasConsent(profile: ProfileGateRow | null): boolean {
  return Boolean(profile?.terms_accepted_at && profile?.ai_processing_accepted_at);
}

export function onboardingComplete(profile: ProfileGateRow | null): boolean {
  return Boolean(profile?.onboarding_completed_at);
}

export function skippedDocuments(profile: ProfileGateRow | null) {
  return Boolean(profile?.preferences?.onboardingSkippedDocuments);
}

export function skippedProfile(profile: ProfileGateRow | null) {
  return Boolean(profile?.preferences?.onboardingSkippedProfile);
}
