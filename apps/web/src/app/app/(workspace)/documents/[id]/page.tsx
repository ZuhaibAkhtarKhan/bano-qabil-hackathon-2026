import Link from "next/link";

import { DeleteDocumentButton } from "@/components/app/delete-document-button";
import { DeleteDocumentVersionButton } from "@/components/app/delete-document-version-button";
import { DocumentVersionUploadForm } from "@/components/app/document-version-upload-form";
import { FlashBanner } from "@/components/app/flash-banner";
import { SubmitButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatDocumentType } from "@/lib/documents/versioning";
import {
  downloadDocumentVersion,
  setCurrentVersion,
} from "@/server/documents/actions";
import { loadDocumentDetail } from "@/server/documents/queries";
import { notFound } from "next/navigation";

const STATUS_DOT = {
  mint: "bg-emerald-500",
  teal: "bg-cyan-500",
  coral: "bg-rose-500",
  muted: "bg-zinc-400",
} as const;

function versionStatusMeta(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "ready") return { label: "Ready", tone: "mint" as const };
  if (normalized.includes("fail") || normalized.includes("error")) {
    return { label: "Failed", tone: "coral" as const };
  }
  if (normalized.includes("process") || normalized.includes("upload")) {
    return { label: "Processing", tone: "teal" as const };
  }
  return { label: status.replace(/_/g, " "), tone: "muted" as const };
}

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
  const detailPath = `/app/documents/${document.id}`;

  return (
    <main id="main" className="min-h-full bg-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-6 lg:px-8">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">Document</p>
          <h1 className="mt-0.5 truncate text-lg font-semibold tracking-tight text-ink">{document.label}</h1>
          <p className="truncate text-xs text-ink-muted">
            {formatDocumentType(document.type)} · {versions.length} version
            {versions.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link href="/app/documents" className="text-sm font-medium text-ink-muted hover:text-ink">
            ← Vault
          </Link>
          <DeleteDocumentButton
            documentId={document.id}
            returnTo="/app/documents"
            label="Delete document"
            confirmMessage={`Delete “${document.label}” permanently? Extracted facts from it will also be removed from Application Memory.`}
          />
        </div>
      </header>

      <div className="space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        {notice || error ? (
          <div className="-mt-2">
            <FlashBanner notice={notice} error={error} />
          </div>
        ) : null}

        <section aria-labelledby="extracted-heading" className="max-w-3xl">
          <h2 id="extracted-heading" className="text-base font-semibold tracking-tight text-ink">
            Extracted text
          </h2>
          <div className="mt-3 rounded-2xl border border-line bg-[#fafbf8]/50 p-4 sm:p-5">
            {extractedPreview ? (
              <p className="max-h-[28rem] overflow-auto whitespace-pre-wrap text-sm leading-6 text-ink-muted">
                {extractedPreview}
              </p>
            ) : (
              <p className="text-sm text-ink-muted">
                No extractable text on the latest version (encrypted PDF, scan-only image, or unsupported
                encoding). The file is still stored.
              </p>
            )}
            <p className="mt-3 text-xs text-ink-muted">
              Uploaded PDF and Word files are read automatically. Extracted facts are written to Application
              Memory as unverified evidence.
            </p>
          </div>
        </section>

        <section aria-labelledby="upload-version-heading" className="max-w-xl">
          <h2 id="upload-version-heading" className="text-base font-semibold tracking-tight text-ink">
            Upload new version
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            New uploads become the latest unless you choose otherwise. You can delete any version below.
          </p>
          <div className="mt-3 rounded-2xl border border-line bg-[#fafbf8]/50 p-4 sm:p-5">
            <DocumentVersionUploadForm documentId={document.id} />
          </div>
        </section>

        <section aria-labelledby="version-history-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="version-history-heading" className="text-base font-semibold tracking-tight text-ink">
                Version history
              </h2>
              <p className="mt-1 text-xs text-ink-muted">
                Set latest, download, or delete individual versions.
              </p>
            </div>
            <p className="rounded-full bg-[#fafbf8] px-2.5 py-1 font-mono text-[11px] text-ink-muted ring-1 ring-line">
              {versions.length}
            </p>
          </div>

          <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[720px] table-fixed text-left text-sm">
              <thead className="border-b border-line bg-[#fafbf8] text-[11px] uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="w-[14%] px-4 py-3 font-medium">Version</th>
                  <th className="w-[28%] px-4 py-3 font-medium">File</th>
                  <th className="w-[12%] px-4 py-3 font-medium">Status</th>
                  <th className="w-[18%] px-4 py-3 font-medium">Uploaded</th>
                  <th className="w-[28%] px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => {
                  const isCurrent = document.current_version_id === version.id;
                  const snapshotCount = snapshotUses.filter(
                    (item) => item.documentVersionId === version.id,
                  ).length;
                  const status = versionStatusMeta(version.status);
                  return (
                    <tr
                      key={version.id}
                      className="border-b border-line last:border-b-0 hover:bg-[#fafbf8]/60"
                    >
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center gap-2 text-xs font-medium text-ink">
                          {version.version_label}
                          {isCurrent ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                              Latest
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-ink-muted">
                        <span className="block truncate">{version.original_filename ?? "file"}</span>
                        <span className="mt-0.5 block text-[11px]">
                          {Math.round(version.byte_size / 1024)} KB
                          {snapshotCount > 0
                            ? ` · ${snapshotCount} snapshot${snapshotCount === 1 ? "" : "s"}`
                            : ""}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                          <span
                            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[status.tone])}
                            aria-hidden="true"
                          />
                          <span className="truncate">{status.label}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-ink-muted">
                        {new Intl.DateTimeFormat("en", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(version.created_at))}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap items-center gap-2">
                          {!isCurrent ? (
                            <form action={setCurrentVersion}>
                              <input type="hidden" name="documentId" value={document.id} />
                              <input type="hidden" name="versionId" value={version.id} />
                              <SubmitButton variant="secondary" size="sm">
                                Set latest
                              </SubmitButton>
                            </form>
                          ) : null}
                          <form action={downloadDocumentVersion}>
                            <input type="hidden" name="versionId" value={version.id} />
                            <SubmitButton variant="ghost" size="sm">
                              Download
                            </SubmitButton>
                          </form>
                          <DeleteDocumentVersionButton
                            versionId={version.id}
                            returnTo={detailPath}
                            label="Delete"
                            confirmMessage={
                              versions.length === 1
                                ? `Delete the only version of “${document.label}”? The whole document will be removed.`
                                : `Delete ${version.version_label} permanently?`
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {snapshotUses.length > 0 ? (
          <section aria-labelledby="snapshots-heading" className="max-w-3xl">
            <h2 id="snapshots-heading" className="text-base font-semibold tracking-tight text-ink">
              Frozen submission history
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              These exact versions were preserved when you marked applications submitted.
            </p>
            <ul className="mt-3 overflow-hidden rounded-2xl border border-line">
              {snapshotUses.map((item) => {
                const version = versions.find((entry) => entry.id === item.documentVersionId);
                return (
                  <li
                    key={`${item.snapshotId}-${item.documentVersionId}`}
                    className="border-b border-line px-4 py-3 text-sm last:border-b-0 hover:bg-[#fafbf8]/60"
                  >
                    <span className="font-medium text-ink">
                      {version?.version_label ?? item.documentVersionId}
                    </span>
                    <span className="ml-2 text-xs text-ink-muted">
                      {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
                        new Date(item.submittedAt),
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
