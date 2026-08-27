import Link from "next/link";

import { DeleteDocumentButton } from "@/components/app/delete-document-button";
import { DocumentVersionUploadForm } from "@/components/app/document-version-upload-form";
import { UploadFeedback } from "@/components/app/upload-feedback";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { SubmitButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDocumentType } from "@/lib/documents/versioning";
import {
  downloadDocumentVersion,
  setCurrentVersion,
} from "@/server/documents/actions";
import { loadDocumentDetail } from "@/server/documents/queries";
import { notFound } from "next/navigation";

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { id } = await params;
  const { notice, error } = await searchParams;
  const data = await loadDocumentDetail(id);
  if (!data) notFound();

  const { document, snapshotUses, extractedPreview } = data;
  const versions = [...(document.document_versions ?? [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Document"
        title={document.label}
        body={`${formatDocumentType(document.type)} · ${versions.length} version${versions.length === 1 ? "" : "s"} retained`}
        actions={
          <DeleteDocumentButton
            documentId={document.id}
            returnTo="/app/documents"
            label="Delete document"
            confirmMessage={`Delete “${document.label}” permanently? Extracted facts from it will also be removed from Application Memory.`}
          />
        }
      />
      <p className="mt-2 text-sm">
        <Link href="/app/documents" className="text-teal underline">
          ← Back to vault
        </Link>
      </p>
      <UploadFeedback notice={notice} error={error} />

      <Card className="mt-8 max-w-2xl p-6">
        <h2 className="text-lg font-medium">Extracted text</h2>
        {extractedPreview ? (
          <p className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap text-sm leading-6 text-ink-muted">
            {extractedPreview}
          </p>
        ) : (
          <p className="mt-3 text-sm text-ink-muted">
            No extractable text on the latest version (encrypted PDF, scan-only image, or unsupported encoding). The file is still stored.
          </p>
        )}
        <p className="mt-3 text-xs text-ink-muted">
          Uploaded PDF and Word files are read automatically. Extracted facts are written to Application Memory as unverified evidence.
        </p>
      </Card>

      <Card className="mt-8 max-w-2xl p-6">
        <h2 className="text-lg font-medium">Upload new version</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Historical versions are never deleted. New uploads become the latest unless you choose otherwise.
        </p>
        <DocumentVersionUploadForm documentId={document.id} />
      </Card>

      <section className="mt-8 max-w-2xl">
        <h2 className="text-lg font-medium">Version history</h2>
        <ul className="mt-4 grid gap-3">
          {versions.map((version) => {
            const isCurrent = document.current_version_id === version.id;
            const snapshotCount = snapshotUses.filter((item) => item.documentVersionId === version.id).length;
            return (
              <li key={version.id}>
                <Card as="article" className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        {version.version_label}
                        {isCurrent ? " · latest" : ""}
                      </p>
                      <p className="mt-1 text-sm text-ink-muted">
                        {version.original_filename ?? "file"} · {Math.round(version.byte_size / 1024)} KB ·{" "}
                        {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
                          new Date(version.created_at),
                        )}
                      </p>
                      {snapshotCount > 0 ? (
                        <p className="mt-1 text-xs text-ink-muted">
                          Used in {snapshotCount} frozen submission snapshot{snapshotCount === 1 ? "" : "s"}
                        </p>
                      ) : null}
                    </div>
                    <StatusPill tone={isCurrent ? "mint" : "muted"}>{version.status}</StatusPill>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {!isCurrent ? (
                      <form action={setCurrentVersion}>
                        <input type="hidden" name="documentId" value={document.id} />
                        <input type="hidden" name="versionId" value={version.id} />
                        <SubmitButton variant="secondary" size="sm">
                          Set as latest
                        </SubmitButton>
                      </form>
                    ) : null}
                    <form action={downloadDocumentVersion}>
                      <input type="hidden" name="versionId" value={version.id} />
                      <SubmitButton variant="ghost" size="sm">
                        Download
                      </SubmitButton>
                    </form>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      {snapshotUses.length > 0 ? (
        <section className="mt-8 max-w-2xl">
          <h2 className="text-lg font-medium">Frozen submission history</h2>
          <p className="mt-1 text-sm text-ink-muted">
            These exact versions were preserved when you marked applications submitted.
          </p>
          <ul className="mt-3 grid gap-2 text-sm">
            {snapshotUses.map((item) => {
              const version = versions.find((entry) => entry.id === item.documentVersionId);
              return (
                <li key={`${item.snapshotId}-${item.documentVersionId}`} className="rounded-lg bg-sand/20 px-3 py-2">
                  {version?.version_label ?? item.documentVersionId} ·{" "}
                  {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(item.submittedAt))}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </WorkspaceMain>
  );
}
