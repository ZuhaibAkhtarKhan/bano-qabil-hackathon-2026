import { FlashBanner } from "@/components/app/flash-banner";
import {
  DocumentsTrackerTable,
  toDocumentsTrackerRow,
} from "@/components/app/documents-tracker-table";
import { ResumeAwareUploadForm } from "@/components/app/resume-aware-upload-form";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { uploadDocument } from "@/server/documents/actions";
import { loadDocumentsWorkspace } from "@/server/workspace/queries";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const { documents } = await loadDocumentsWorkspace();
  const rows = documents.map(toDocumentsTrackerRow);

  return (
    <main id="main" className="min-h-full bg-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-6 lg:px-8">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-ink">Documents</h1>
          <p className="truncate text-xs text-ink-muted">
            Version history for kit files — delete any version, or the whole document.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ButtonLink href="/app/resumes" size="sm" variant="secondary">
            Resumes
          </ButtonLink>
          <ButtonLink href="/app/memory" size="sm" variant="ghost">
            Your kit
          </ButtonLink>
        </div>
      </header>

      <div className="space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        {notice || error ? (
          <div className="-mt-2">
            <FlashBanner notice={notice} error={error} />
          </div>
        ) : null}

        <section aria-labelledby="upload-document-heading">
          <div>
            <h2 id="upload-document-heading" className="text-base font-semibold tracking-tight text-ink">
              Upload a file
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              Same resume category appends a new version. Deleting a version (or the file) removes vault storage.
            </p>
          </div>
          <div className="mt-4 max-w-xl rounded-2xl border border-line bg-[#fafbf8]/50 p-4 sm:p-5">
            <ResumeAwareUploadForm action={uploadDocument} mode="documents" submitLabel="Upload" />
          </div>
        </section>

        <section aria-labelledby="vault-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="vault-heading" className="text-base font-semibold tracking-tight text-ink">
                Vault
              </h2>
              <p className="mt-1 text-xs text-ink-muted">
                Open a document to manage individual versions, download, or set latest.
              </p>
            </div>
            <p className="rounded-full bg-[#fafbf8] px-2.5 py-1 font-mono text-[11px] text-ink-muted ring-1 ring-line">
              {rows.length}
            </p>
          </div>

          {rows.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                eyebrow="Empty"
                title="No files yet"
                body="Upload a resume or supporting document. Same resume category appends versions without deleting history."
              />
            </div>
          ) : (
            <div className="mt-4">
              <DocumentsTrackerTable rows={rows} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
