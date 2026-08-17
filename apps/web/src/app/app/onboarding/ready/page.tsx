import Link from "next/link";

import { finishOnboarding } from "@/app/app/actions";
import { ensureOnboardingStep } from "@/lib/onboarding";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { ERRORS } from "@/server/http/flash";

export default async function OnboardingReadyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const state = await ensureOnboardingStep("ready");
  const { error } = await searchParams;
  const errorMessage = error && error in ERRORS ? ERRORS[error as keyof typeof ERRORS] : null;

  return (
    <OnboardingShell
      eyebrow="Onboarding"
      title="Application Memory ready"
      body="Your workspace is prepared. Verified evidence powers Fit Index and grounded drafts. You can add an opportunity whenever you are ready."
      step="ready"
    >
      {errorMessage ? (
        <div className="mb-6">
          <Notice tone="coral">{errorMessage}</Notice>
        </div>
      ) : null}

      <dl className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Documents" value={state.documentCount} hint="Private vault" />
        <MetricCard label="Evidence" value={state.evidenceCount} hint="Extracted + manual" />
        <MetricCard label="Verified" value={state.verifiedEvidenceCount} hint="Eligible for generation" />
      </dl>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <form action={finishOnboarding}>
          <Button type="submit" className="w-full">
            Enter workspace
          </Button>
        </form>
        <ButtonLink href="/app/opportunities" variant="secondary" className="w-full">
          Add first opportunity
        </ButtonLink>
      </div>

      <p className="mt-6 text-sm text-ink-muted">
        Need to adjust facts?{" "}
        <Link className="underline" href="/app/memory">
          Open Application Memory
        </Link>
        . Extraction never equals verification — keep reviewing as you go.
      </p>
    </OnboardingShell>
  );
}
