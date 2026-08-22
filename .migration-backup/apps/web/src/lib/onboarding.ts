import { onboardingHref, type OnboardingStep } from "@1apply/contracts";
import { redirect } from "next/navigation";

import { loadOnboardingState, onboardingComplete } from "@/lib/profile";

export async function ensureOnboardingStep(expected: OnboardingStep) {
  const state = await loadOnboardingState();
  if (!state) redirect("/sign-in?next=/app/onboarding/consent");
  if (onboardingComplete(state.profile)) redirect("/app");
  if (state.step !== expected && state.step !== "done") {
    redirect(onboardingHref(state.step));
  }
  return state;
}

export async function requireIncompleteOnboarding() {
  const state = await loadOnboardingState();
  if (!state) redirect("/sign-in?next=/app/onboarding/consent");
  if (onboardingComplete(state.profile)) redirect("/app");
  redirect(onboardingHref(state.step));
}
