import { skipOnboardingDocuments } from "@/app/app/actions";
import { continueOnboardingReview } from "@/server/onboarding/actions";
import { uploadOnboardingKitDocument } from "@/server/onboarding/upload";
import { ensureOnboardingStep } from "@/lib/onboarding";
import { loadOnboardingState } from "@/lib/profile";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { ResumeAwareUploadForm } from "@/components/app/resume-aware-upload-form";
import { Button } from "@/components/ui/button";
import { Field, FileUpload, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { ERRORS, FLASH } from "@/server/http/flash";
import { kitStatus } from "@1apply/domain";
import { parseWorkspacePreferences } from "@/lib/workspace-preferences";
import { loadResumeCatalog } from "@/server/resumes/queries";

export default async function OnboardingDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  await ensureOnboardingStep("documents");
  const state = await loadOnboardingState();
  const { notice, error } = await searchParams;
  const noticeMessage = notice && notice in FLASH ? FLASH[notice as keyof typeof FLASH] : null;
  const errorMessage = error && error in ERRORS ? ERRORS[error as keyof typeof ERRORS] : null;
  const prefs = parseWorkspacePreferences(state?.profile.preferences ?? {});
  const kit = kitStatus({
    displayName: state?.profile.display_name,
    university: prefs.university,
    educationSummary: prefs.educationSummary,
    documents: state?.documents ?? [],
  });
  const resumeCatalog = await loadResumeCatalog().catch(() => []);

  return (
    <OnboardingShell
      eyebrow="Onboarding"
      title="Your kit"
      body="Upload once: resume by category, CNIC, and B-form. Re-uploading the same category creates the next version automatically."
      step="documents"
    >
      {noticeMessage ? (
        <div className="mb-6">
          <Notice tone="mint">{noticeMessage}</Notice>
        </div>
      ) : null}
      {errorMessage ? (
        <div className="mb-6">
          <Notice tone="coral">{errorMessage}</Notice>
        </div>
      ) : null}

      <p className="mb-4 text-sm text-ink-muted">
        In kit: {kit.hasResume ? "resume" : "no resume"} · {kit.hasIdentityDocument ? "CNIC" : "no CNIC"} ·{" "}
        {kit.hasFamilyDocument ? "B-form" : "no B-form"}.
      </p>

      <div className="grid gap-4">
        <div className="grid gap-4 rounded-2xl border border-line bg-white p-6">
          <h2 className="text-base font-medium">Resume / CV</h2>
          <p className="text-sm text-ink-muted">
            Pick a category to remember this resume. Matching still scores every resume with AI — category is not a job
            filter.
          </p>
          <ResumeAwareUploadForm action={uploadOnboardingKitDocument} mode="kit" submitLabel="Upload resume" />
          {resumeCatalog.length > 0 ? (
            <ul className="mt-2 grid gap-2 text-sm text-ink-muted">
              {resumeCatalog.map((group) => (
                <li key={group.documentId}>
                  {group.categoryLabel} · current {group.currentVersionLabel ?? "v1"} · {group.versions.length} version
                  {group.versions.length === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <form action={uploadOnboardingKitDocument} className="grid gap-4 rounded-2xl border border-line bg-white p-6">
          <input type="hidden" name="type" value="identity_document" />
          <h2 className="text-base font-medium">CNIC / national ID</h2>
          <Field label="Label" htmlFor="cnic-label">
            <Input id="cnic-label" name="label" defaultValue="CNIC" required />
          </Field>
          <FileUpload id="cnic-file" label="CNIC file" accept=".txt,.md,.pdf,.docx,text/plain,application/pdf" />
          <Button type="submit" variant="secondary">
            Upload CNIC
          </Button>
        </form>

        <form action={uploadOnboardingKitDocument} className="grid gap-4 rounded-2xl border border-line bg-white p-6">
          <input type="hidden" name="type" value="family_document" />
          <h2 className="text-base font-medium">B-form</h2>
          <Field label="Label" htmlFor="bform-label">
            <Input id="bform-label" name="label" defaultValue="B-form" required />
          </Field>
          <FileUpload id="bform-file" label="B-form file" accept=".txt,.md,.pdf,.docx,text/plain,application/pdf" />
          <Button type="submit" variant="secondary">
            Upload B-form
          </Button>
        </form>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <form action={continueOnboardingReview}>
          <Button type="submit">Continue to review</Button>
        </form>
        <form action={skipOnboardingDocuments}>
          <Button type="submit" variant="ghost">
            Skip for now — remind me next sign-in
          </Button>
        </form>
      </div>
    </OnboardingShell>
  );
}
