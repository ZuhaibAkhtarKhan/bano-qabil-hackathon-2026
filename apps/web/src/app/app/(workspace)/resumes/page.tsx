import Link from "next/link";

import { DeleteDocumentButton } from "@/components/app/delete-document-button";
import { UploadFeedback } from "@/components/app/upload-feedback";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { ResumeAwareUploadForm } from "@/components/app/resume-aware-upload-form";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { uploadMemoryDocument } from "@/server/memory/actions";
import { loadResumeCatalog } from "@/server/resumes/queries";

export default async function ResumesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const catalog = await loadResumeCatalog();

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Resumes"
        title="Categories and versions"
        body="Categories help you remember which resume is which. Job fit scores every resume with AI — category is never used as a filter. Versions are assigned by upload time."
        actions={<ButtonLink href="/app/memory?section=personal">Open your kit</ButtonLink>}
      />
      <UploadFeedback notice={notice} error={error} />

      <Card className="mt-8 max-w-xl p-6">
        <h2 className="text-sm font-semibold tracking-tight text-ink">Upload resume</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Same pipeline as Memory and onboarding — uploading the same category again becomes the next version.
        </p>
        <div className="mt-4">
          <ResumeAwareUploadForm
            action={uploadMemoryDocument}
            mode="kit"
            hiddenFields={{ section: "personal" }}
            submitLabel="Upload resume"
          />
        </div>
      </Card>

      {catalog.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            eyebrow="Empty"
            title="No resumes on file"
            body="Upload a categorized resume here or in Your kit. Match scoring stays blank until a real file exists."
          />
        </div>
      ) : (
        <ul className="mt-8 grid max-w-2xl gap-4">
          {catalog.map((group) => (
            <li key={group.documentId}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">Category</p>
                    <h3 className="mt-1 text-base font-semibold tracking-tight text-ink">{group.categoryLabel}</h3>
                    <p className="mt-1 text-xs text-ink-muted">
                      Current {group.currentVersionLabel ?? "v1"} · {group.versions.length} version
                      {group.versions.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Link href={`/app/documents/${group.documentId}`} className="text-sm font-medium text-ink-muted hover:text-ink">
                      Open vault →
                    </Link>
                    <DeleteDocumentButton
                      documentId={group.documentId}
                      returnTo="/app/resumes"
                      label="Delete resume"
                      confirmMessage={`Delete the ${group.categoryLabel} resume and all its versions? Facts extracted from it will also be removed from Application Memory.`}
                    />
                  </div>
                </div>
                <ol className="mt-4 grid gap-2">
                  {group.versions.map((version) => (
                    <li
                      key={version.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-[#fafbf8] px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-ink">{version.versionLabel}</span>
                      <span className="text-xs text-ink-muted">
                        {version.fileName ?? "file"} · {version.status} ·{" "}
                        {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
                          new Date(version.createdAt),
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </WorkspaceMain>
  );
}
