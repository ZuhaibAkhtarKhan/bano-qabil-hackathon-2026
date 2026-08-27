import { skipOnboardingDocuments } from "@/app/app/actions";
import { continueOnboardingReview } from "@/server/onboarding/actions";
import { uploadOnboardingKitDocument } from "@/server/onboarding/upload";
import { ensureOnboardingStep } from "@/lib/onboarding";
import { loadOnboardingState } from "@/lib/profile";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { KitDocumentUploadForm, UploadSubmitButton } from "@/components/app/kit-document-upload-form";
import { ResumeAwareUploadForm } from "@/components/app/resume-aware-upload-form";
import { UploadFeedback } from "@/components/app/upload-feedback";
import { UseInKitField } from "@/components/app/use-in-kit-field";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { CNIC_PHARM_B_LABEL, kitStatus } from "@1apply/domain";
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
      body={`Upload what you have — resume by category and optional ${CNIC_PHARM_B_LABEL}. Nothing here is required to continue; skip any file and fill it later in Your kit.`}
      step="documents"
    >
      <UploadFeedback notice={notice} error={error} />

      <p className="mb-4 mt-6 text-sm text-ink-muted">
        In kit: {kit.hasResume ? "resume ready" : "resume missing"} · {CNIC_PHARM_B_LABEL}{" "}
        {kit.hasCnicPharmB ? "ready" : "optional — not uploaded yet"}.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-4 rounded-2xl border border-line bg-white p-6">
          <h2 className="text-base font-medium">Resume / CV</h2>
          <p className="text-sm text-ink-muted">
            Optional. Pick a category to remember this resume. Matching still scores every resume with AI — category is
            not a job filter.
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

        <KitDocumentUploadForm
          action={uploadOnboardingKitDocument}
          className="grid gap-4 rounded-2xl border border-line bg-white p-6"
          showUseInKit={false}
        >
          <h2 className="text-base font-medium">{CNIC_PHARM_B_LABEL}</h2>
          <p className="text-sm text-ink-muted">
            Optional. Choose CNIC or Pharm-B — either one is enough. Skip if you do not have it yet.
          </p>
          <Field label="Document type" htmlFor="onboarding-id-doc-type">
            <Select id="onboarding-id-doc-type" name="type" defaultValue="identity_document">
              <option value="identity_document">CNIC</option>
              <option value="family_document">Pharm-B</option>
            </Select>
          </Field>
          <input type="hidden" name="label" value={CNIC_PHARM_B_LABEL} />
          <Field label="File" htmlFor="onboarding-id-doc-file">
            <Input
              id="onboarding-id-doc-file"
              name="file"
              type="file"
              required
              accept=".txt,.md,.pdf,.docx,text/plain,application/pdf"
            />
          </Field>
          <UseInKitField defaultChecked />
          <UploadSubmitButton size="md">Upload</UploadSubmitButton>
        </KitDocumentUploadForm>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <form action={continueOnboardingReview}>
          <SubmitButton>Continue to review</SubmitButton>
        </form>
        <form action={skipOnboardingDocuments}>
          <SubmitButton variant="ghost">Skip for now — remind me next sign-in</SubmitButton>
        </form>
      </div>
    </OnboardingShell>
  );
}
