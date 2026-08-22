import { acceptConsent } from "@/app/app/actions";
import { ensureOnboardingStep } from "@/lib/onboarding";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { Button } from "@/components/ui/button";

export default async function OnboardingConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await ensureOnboardingStep("consent");
  const { error } = await searchParams;
  const message =
    error === "required"
      ? "Both consents are required before 1-Apply can store or process your materials."
      : error === "save"
        ? "Could not save consent. Confirm database migrations are applied, then try again."
        : null;

  return (
    <OnboardingShell
      eyebrow="Onboarding"
      title="Consent before memory"
      body="1-Apply stores resumes, answers, and application history. AI processing is explained separately from the product terms. Nothing is extracted until you agree."
      step="consent"
    >
      <form action={acceptConsent} className="space-y-4">
        <label className="flex items-start gap-3 rounded-2xl border border-line bg-white p-4 text-sm">
          <input type="checkbox" name="termsAccepted" className="mt-1" required />
          <span>
            I accept the terms and privacy notice for storing my application materials in a private account.
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-2xl border border-line bg-white p-4 text-sm">
          <input type="checkbox" name="aiProcessingAccepted" className="mt-1" required />
          <span>
            I understand that AI features may process my approved evidence to extract facts and draft answers,
            and that generated claims must still be reviewed by me.
          </span>
        </label>
        {message ? (
          <p className="text-sm text-rose-700" role="alert">
            {message}
          </p>
        ) : null}
        <Button type="submit">Continue</Button>
      </form>
    </OnboardingShell>
  );
}
