import { ensureOnboardingStep } from "@/lib/onboarding";
import { loadOnboardingProfileDetails } from "@/lib/profile";
import { parseWorkspacePreferences } from "@/lib/workspace-preferences";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { saveOnboardingProfile } from "@/server/onboarding/actions";

export default async function OnboardingProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const state = await ensureOnboardingStep("profile");
  const { error } = await searchParams;
  const details = await loadOnboardingProfileDetails();
  const profile = details?.details;

  return (
    <OnboardingShell
      eyebrow="Onboarding"
      title="Name, university, education"
      body="Confirm the facts that repeat on every form. Resume extraction can fill the rest — you will review before anything counts as verified."
      step="profile"
    >
      <form action={saveOnboardingProfile} className="grid gap-4 rounded-2xl border border-line bg-white p-6">
        <Field label="Full name" htmlFor="displayName" hint="Required to continue.">
          <Input id="displayName" name="displayName" defaultValue={profile?.display_name ?? ""} required />
        </Field>
        <Field label="University" htmlFor="university" hint="Required. Used on every posting.">
          <Input
            id="university"
            name="university"
            defaultValue={parseWorkspacePreferences(state.profile.preferences).university}
            placeholder="NUST"
            required
          />
        </Field>
        <Field label="Education" htmlFor="educationSummary" hint="Required. Degree and year, for example BS Computer Science, 2026.">
          <Input
            id="educationSummary"
            name="educationSummary"
            defaultValue={parseWorkspacePreferences(state.profile.preferences).educationSummary}
            placeholder="BS Computer Science, 2026"
            required
          />
        </Field>
        <Field label="Headline" htmlFor="headline">
          <Input id="headline" name="headline" defaultValue={profile?.headline ?? ""} placeholder="Full-stack intern · retrieval systems" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={profile?.phone ?? ""} autoComplete="tel" />
          </Field>
          <Field label="Work authorization" htmlFor="workAuthorization">
            <Input id="workAuthorization" name="workAuthorization" defaultValue={profile?.work_authorization ?? ""} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" htmlFor="locationCity">
            <Input id="locationCity" name="locationCity" defaultValue={profile?.location_city ?? ""} autoComplete="address-level2" />
          </Field>
          <Field label="Country" htmlFor="locationCountry">
            <Input id="locationCountry" name="locationCountry" defaultValue={profile?.location_country ?? ""} autoComplete="country-name" />
          </Field>
        </div>
        <Field label="Availability" htmlFor="availability">
          <Input id="availability" name="availability" defaultValue={profile?.availability ?? ""} placeholder="June 2026 · full-time" />
        </Field>
        <Field label="LinkedIn" htmlFor="linkedinUrl">
          <Input id="linkedinUrl" name="linkedinUrl" type="url" defaultValue={profile?.linkedin_url ?? ""} />
        </Field>
        <Field label="GitHub" htmlFor="githubUrl">
          <Input id="githubUrl" name="githubUrl" type="url" defaultValue={profile?.github_url ?? ""} />
        </Field>
        <Field label="Portfolio" htmlFor="portfolioUrl">
          <Input id="portfolioUrl" name="portfolioUrl" type="url" defaultValue={profile?.portfolio_url ?? ""} />
        </Field>
        {error === "required" ? (
          <p className="text-sm text-rose-700" role="alert">
            Name, university, and education are required before you can continue.
          </p>
        ) : error === "save" ? (
          <p className="text-sm text-rose-700" role="alert">
            Could not save your profile. Try again.
          </p>
        ) : null}
        <SubmitButton>Continue to your kit</SubmitButton>
      </form>
      <p className="mt-4 text-xs text-ink-muted">
        Signed in as {state.profile.email}. Education, projects, experience, and skills can be extracted from your resume on the next step.
      </p>
    </OnboardingShell>
  );
}
