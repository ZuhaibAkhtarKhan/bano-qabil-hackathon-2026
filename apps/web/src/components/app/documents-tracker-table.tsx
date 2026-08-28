import Link from "next/link";

import { DeleteDocumentButton } from "@/components/app/delete-document-button";
import { cn } from "@/lib/cn";
import { formatDocumentType } from "@/lib/documents/versioning";
import type { DocumentListRow } from "@/server/types";

const STATUS_DOT = {
  mint: "bg-emerald-500",
  teal: "bg-cyan-500",
  coral: "bg-rose-500",
  sand: "bg-amber-500",
  muted: "bg-zinc-400",
} as const;

function versionStatusMeta(status: string | undefined) {
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "ready") return { label: "Ready", tone: "mint" as const };
  if (normalized.includes("fail") || normalized.includes("error")) {
    return { label: "Failed", tone: "coral" as const };
  }
  if (normalized.includes("process") || normalized.includes("upload")) {
    return { label: "Processing", tone: "teal" as const };
  }
  return { label: status?.replace(/_/g, " ") || "—", tone: "muted" as const };
}

export type DocumentsTrackerRow = {
  id: string;
  href: string;
  label: string;
  typeLabel: string;
  initial: string;
  latestLabel: string;
  versionCount: number;
  statusLabel: string;
  statusTone: keyof typeof STATUS_DOT;
  uploadedLabel: string;
};

export function toDocumentsTrackerRow(document: DocumentListRow): DocumentsTrackerRow {
  const versions = [...(document.document_versions ?? [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const current =
    versions.find((item) => item.id === document.current_version_id) ?? versions[0] ?? null;
  const status = versionStatusMeta(current?.status);
  const uploadedAt = current?.created_at ?? document.created_at;
  return {
    id: document.id,
    href: `/app/documents/${document.id}`,
    label: document.label?.trim() || "Untitled document",
    typeLabel: formatDocumentType(document.type),
    initial: (document.label?.trim() || "D").slice(0, 2).toUpperCase(),
    latestLabel: current ? String(current.version_label) : "—",
    versionCount: versions.length,
    statusLabel: status.label,
    statusTone: status.tone,
    uploadedLabel: uploadedAt
      ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(uploadedAt))
      : "—",
  };
}

/** Table aligned with Dashboard → All applications styling. */
export function DocumentsTrackerTable({
  rows,
  returnTo = "/app/documents",
}: {
  rows: DocumentsTrackerRow[];
  returnTo?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[720px] table-fixed text-left text-sm">
        <thead className="border-b border-line bg-[#fafbf8] text-[11px] uppercase tracking-wider text-ink-muted">
          <tr>
            <th className="w-[34%] px-4 py-3 font-medium">Document</th>
            <th className="w-[16%] px-4 py-3 font-medium">Type</th>
            <th className="w-[12%] px-4 py-3 font-medium">Latest</th>
            <th className="w-[14%] px-4 py-3 font-medium">Status</th>
            <th className="w-[12%] px-4 py-3 font-medium">Uploaded</th>
            <th className="w-[12%] px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line last:border-b-0 hover:bg-[#fafbf8]/60">
              <td className="px-4 py-3.5">
                <Link href={row.href} className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-white text-xs font-semibold text-ink">
                    {row.initial}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium leading-tight text-ink">{row.label}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      {row.versionCount} version{row.versionCount === 1 ? "" : "s"}
                    </span>
                  </span>
                </Link>
              </td>
              <td className="px-4 py-3.5 text-xs capitalize text-ink-muted">{row.typeLabel}</td>
              <td className="px-4 py-3.5 text-xs font-medium text-ink">{row.latestLabel}</td>
              <td className="px-4 py-3.5">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[row.statusTone])} aria-hidden="true" />
                  <span className="truncate">{row.statusLabel}</span>
                </span>
              </td>
              <td className="px-4 py-3.5 text-xs text-ink-muted">{row.uploadedLabel}</td>
              <td className="px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={row.href} className="text-xs font-medium text-ink hover:underline">
                    Open
                  </Link>
                  <DeleteDocumentButton
                    documentId={row.id}
                    returnTo={returnTo}
                    label="Delete"
                    confirmMessage={`Delete “${row.label}” permanently? Extracted facts from it will also be removed from Application Memory.`}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
