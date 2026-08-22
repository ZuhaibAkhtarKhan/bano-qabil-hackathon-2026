import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { onboardingComplete, loadOnboardingState } from "@/lib/profile";

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const state = await loadOnboardingState();
  if (!state) {
    redirect("/sign-in?next=/app/onboarding/consent");
  }

  if (onboardingComplete(state.profile)) {
    redirect("/app");
  }

  return children;
}
