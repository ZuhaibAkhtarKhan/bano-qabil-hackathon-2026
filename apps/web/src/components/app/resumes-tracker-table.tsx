import Link from "next/link";

import { DeleteDocumentButton } from "@/components/app/delete-document-button";
import { DeleteDocumentVersionButton } from "@/components/app/delete-document-version-button";
import { cn } from "@/lib/cn";
import type { ResumeCategoryGroup } from "@/server/resumes/queries";

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

/** Category groups with nested version rows — dashboard tracker chrome. */
export function ResumesTrackerTable({ groups }: { groups: ResumeCategoryGroup[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <table className="w-full min-w-[720px] table-fixed text-left text-sm">
        <thead className="border-b border-line bg-[#fafbf8] text-[11px] uppercase tracking-wider text-ink-muted">
          <tr>
            <th className="w-[28%] px-4 py-3 font-medium">Category</th>
            <th className="w-[12%] px-4 py-3 font-medium">Version</th>
            <th className="w-[24%] px-4 py-3 font-medium">File</th>
            <th className="w-[14%] px-4 py-3 font-medium">Status</th>
            <th className="w-[12%] px-4 py-3 font-medium">Uploaded</th>
            <th className="w-[10%] px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const versions = [...group.versions].sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
            );
            const initial = group.categoryLabel.slice(0, 2).toUpperCase();
            return versions.map((version, index) => {
              const status = versionStatusMeta(version.status);
              const isLatest = version.versionLabel === group.currentVersionLabel;
              const isFirst = index === 0;
              return (
                <tr
                  key={version.id}
                  className="border-b border-line last:border-b-0 hover:bg-[#fafbf8]/60"
                >
                  <td className="px-4 py-3.5 align-top">
                    {isFirst ? (
                      <div className="flex items-start gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-white text-xs font-semibold text-ink">
                          {initial}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium leading-tight text-ink">
                            {group.categoryLabel}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                            <Link
                              href={`/app/documents/${group.documentId}`}
                              className="font-medium text-ink hover:underline"
                            >
                              Open vault
                            </Link>
                            <DeleteDocumentButton
                              documentId={group.documentId}
                              returnTo="/app/resumes"
                              label="Delete all"
                              confirmMessage={`Delete the ${group.categoryLabel} resume and all its versions? Facts extracted from it will also be removed from Application Memory.`}
                            />
                          </span>
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3.5 align-top">
                    <span className="inline-flex items-center gap-2 text-xs font-medium text-ink">
                      {version.versionLabel}
                      {isLatest ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                          Latest
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 align-top text-xs text-ink-muted">
                    <span className="block truncate">{version.fileName ?? "file"}</span>
                  </td>
                  <td className="px-4 py-3.5 align-top">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                      <span
                        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[status.tone])}
                        aria-hidden="true"
                      />
                      <span className="truncate">{status.label}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3.5 align-top text-xs text-ink-muted">
                    {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(version.createdAt))}
                  </td>
                  <td className="px-4 py-3.5 align-top">
                    <DeleteDocumentVersionButton
                      versionId={version.id}
                      returnTo="/app/resumes"
                      label="Delete"
                      confirmMessage={
                        versions.length === 1
                          ? `Delete the only version of “${group.categoryLabel}”? The whole resume will be removed.`
                          : `Delete ${version.versionLabel} of “${group.categoryLabel}”?`
                      }
                    />
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}
