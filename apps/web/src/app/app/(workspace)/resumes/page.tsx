import { FlashBanner } from "@/components/app/flash-banner";
import { ResumeAwareUploadForm } from "@/components/app/resume-aware-upload-form";
import { ResumesTrackerTable } from "@/components/app/resumes-tracker-table";
import { ButtonLink } from "@/components/ui/button";
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
    <main id="main" className="min-h-full bg-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-6 lg:px-8">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-ink">Resumes</h1>
          <p className="truncate text-xs text-ink-muted">
            Categories for your remembrance — delete any version without wiping the whole category.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ButtonLink href="/app/documents" size="sm" variant="secondary">
            Documents
          </ButtonLink>
          <ButtonLink href="/app/memory?section=personal" size="sm" variant="ghost">
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

        <section aria-labelledby="upload-resume-heading">
          <div>
            <h2 id="upload-resume-heading" className="text-base font-semibold tracking-tight text-ink">
              Upload resume
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              Same category becomes the next version by upload time. Job fit scores every file with AI.
            </p>
          </div>
          <div className="mt-4 max-w-xl rounded-2xl border border-line bg-[#fafbf8]/50 p-4 sm:p-5">
            <ResumeAwareUploadForm
              action={uploadMemoryDocument}
              mode="kit"
              hiddenFields={{ section: "personal" }}
              submitLabel="Upload resume"
            />
          </div>
        </section>

        <section aria-labelledby="resume-catalog-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="resume-catalog-heading" className="text-base font-semibold tracking-tight text-ink">
                Categories and versions
              </h2>
              <p className="mt-1 text-xs text-ink-muted">
                Each row is a version. Delete one to prune history, or delete all for the category.
              </p>
            </div>
            <p className="rounded-full bg-[#fafbf8] px-2.5 py-1 font-mono text-[11px] text-ink-muted ring-1 ring-line">
              {catalog.reduce((sum, group) => sum + group.versions.length, 0)}
            </p>
          </div>

          {catalog.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                eyebrow="Empty"
                title="No resumes on file"
                body="Upload a categorized resume here or in Your kit. Match scoring stays blank until a real file exists."
              />
            </div>
          ) : (
            <div className="mt-4">
              <ResumesTrackerTable groups={catalog} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
