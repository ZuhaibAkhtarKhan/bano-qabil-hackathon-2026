import { skipOnboardingDocuments } from "@/app/app/actions";
import { ensureOnboardingStep } from "@/lib/onboarding";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { Button } from "@/components/ui/button";
import { Field, FileUpload, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/feedback";
import { uploadOnboardingResume } from "@/server/onboarding/upload";
import { ERRORS, FLASH } from "@/server/http/flash";

export default async function OnboardingDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  await ensureOnboardingStep("documents");
  const { notice, error } = await searchParams;
  const noticeMessage = notice && notice in FLASH ? FLASH[notice as keyof typeof FLASH] : null;
  const errorMessage = error && error in ERRORS ? ERRORS[error as keyof typeof ERRORS] : null;

  return (
    <OnboardingShell
      eyebrow="Onboarding"
      title="Upload your resume"
      body="Text and Markdown resumes can be parsed immediately. PDF and DOCX are stored safely — add facts manually or re-upload as .txt for extraction."
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

      <form action={uploadOnboardingResume} className="grid gap-4 rounded-2xl border border-line bg-white p-6">
        <Field label="Label" htmlFor="resume-label">
          <Input id="resume-label" name="label" defaultValue="Primary resume" required />
        </Field>
        <FileUpload
          id="resume-file"
          label="Resume file"
          accept=".txt,.md,.pdf,.docx,text/plain,application/pdf"
          hint="TXT or MD extracts education, projects, experience, skills, and certifications as unverified evidence."
        />
        <Button type="submit">Upload and extract</Button>
      </form>

      <form action={skipOnboardingDocuments} className="mt-4">
        <Button type="submit" variant="ghost">
          Skip for now — I will add evidence manually
        </Button>
      </form>
    </OnboardingShell>
  );
}
