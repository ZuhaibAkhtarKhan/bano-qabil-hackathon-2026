import { kitStatus } from "@1apply/domain";
import { onboardingStepSchema, postAuthHref, type OnboardingStep } from "@1apply/contracts";

import { onboardingComplete } from "@/lib/profile-state";
import { parseWorkspacePreferences } from "@/lib/workspace-preferences";

export const KIT_REMINDED_COOKIE = "kit_reminded";

export function kitMissingItems(input: {
  displayName: string | null | undefined;
  preferences: Record<string, unknown> | null | undefined;
  documents: Array<{ type: string; label: string }>;
}): string[] {
  const prefs = parseWorkspacePreferences(input.preferences);
  return kitStatus({
    displayName: input.displayName,
    university: prefs.university,
    educationSummary: prefs.educationSummary,
    documents: input.documents,
  }).missing;
}

export function destinationAfterAuth(input: {
  onboardingCompletedAt: string | null | undefined;
  onboardingStep: string | null | undefined;
  displayName: string | null | undefined;
  preferences: Record<string, unknown> | null | undefined;
  documents: Array<{ type: string; label: string }>;
}): string {
  const parsed = onboardingStepSchema.safeParse(input.onboardingStep);
  const onboardingStep: OnboardingStep = parsed.success ? parsed.data : "consent";
  return postAuthHref({
    onboardingCompleted: onboardingComplete({
      terms_accepted_at: null,
      ai_processing_accepted_at: null,
      onboarding_completed_at: input.onboardingCompletedAt ?? null,
    }),
    onboardingStep,
    kitMissing: kitMissingItems(input),
  });
}
