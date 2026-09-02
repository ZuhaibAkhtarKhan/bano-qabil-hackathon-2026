import Link from "next/link";

import { cn } from "@/lib/cn";

export type ApplicationsTrackerRow = {
  id: string;
  href: string;
  company: string;
  role: string;
  resume: string;
  cover: string;
  statusLabel: string;
  statusTone: "mint" | "teal" | "coral" | "sand" | "muted";
  appliedLabel: string;
  initial: string;
  sourceLabel: string | null;
  /** Fields still waiting on the applicant in Need You. */
  needsYouCount: number;
  filter?: "all" | "in_flight" | "needs_you" | "failed" | "skipped";
};

const STATUS_DOT = {
  mint: "bg-emerald-500",
  teal: "bg-cyan-500",
  coral: "bg-rose-500",
  sand: "bg-amber-500",
  muted: "bg-zinc-400",
} as const;

function docTone(value: string) {
  if (value === "Ready") return "text-emerald-700";
  if (value === "Missing") return "text-rose-700";
  return "text-ink-muted";
}

/** Same table used on Dashboard → All applications and /app/applications list view. */
export function ApplicationsTrackerTable({ rows }: { rows: ApplicationsTrackerRow[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[800px] table-fixed text-left text-sm">
        <thead className="border-b border-line bg-[#fafbf8] text-[11px] uppercase tracking-wider text-ink-muted">
          <tr>
            <th className="w-[30%] px-4 py-3 font-medium">Position</th>
            <th className="w-[10%] px-4 py-3 font-medium">Resume</th>
            <th className="w-[12%] px-4 py-3 font-medium">Cover letter</th>
            <th className="w-[10%] px-4 py-3 font-medium">Need you</th>
            <th className="w-[20%] px-4 py-3 font-medium">Status</th>
            <th className="w-[18%] px-4 py-3 font-medium">Submitted</th>
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
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium leading-tight text-ink">{row.company}</span>
                      {row.sourceLabel ? (
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                          {row.sourceLabel}
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-ink-muted">{row.role}</span>
                  </span>
                </Link>
              </td>
              <td className={cn("px-4 py-3.5 text-xs", docTone(row.resume))}>{row.resume}</td>
              <td className={cn("px-4 py-3.5 text-xs", docTone(row.cover))}>{row.cover}</td>
              <td className="px-4 py-3.5 text-xs">
                {row.needsYouCount > 0 ? (
                  <Link
                    href="/app/needs-you"
                    className="font-medium text-rose-700 hover:underline"
                    title={`${row.needsYouCount} field${row.needsYouCount === 1 ? "" : "s"} need input`}
                  >
                    {row.needsYouCount}
                  </Link>
                ) : (
                  <span className="text-ink-muted">0</span>
                )}
              </td>
              <td className="px-4 py-3.5">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[row.statusTone])} aria-hidden="true" />
                  <span className="truncate">{row.statusLabel}</span>
                </span>
              </td>
              <td className="px-4 py-3.5 text-xs">
                <span className={row.statusLabel === "Submitted" ? "font-medium text-emerald-700" : "text-ink-muted"}>
                  {row.appliedLabel}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Compact row matching Dashboard → All applications styling, for board columns. */
export function ApplicationsTrackerBoardCard({ row }: { row: ApplicationsTrackerRow }) {
  return (
    <Link
      href={row.href}
      className="block rounded-2xl border border-line bg-white px-3.5 py-3 transition-colors hover:bg-[#fafbf8]/60"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-white text-xs font-semibold text-ink">
          {row.initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium leading-tight text-ink">{row.company}</span>
            {row.sourceLabel ? (
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                {row.sourceLabel}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-muted">{row.role}</span>
          <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-ink">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[row.statusTone])} aria-hidden="true" />
            <span className="truncate">{row.statusLabel}</span>
          </span>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">
            <span>
              Resume · <span className={docTone(row.resume)}>{row.resume}</span>
            </span>
            <span>
              Cover · <span className={docTone(row.cover)}>{row.cover}</span>
            </span>
            <span className={row.needsYouCount > 0 ? "font-medium text-rose-700" : undefined}>
              Need you · {row.needsYouCount}
            </span>
            <span>{row.appliedLabel}</span>
          </div>
        </span>
      </div>
    </Link>
  );
}

/** Board columns aligned with Dashboard → All applications filter chips. */
export const APPLICATIONS_TRACKER_BOARD_COLUMNS = [
  { id: "in_flight", title: "In flight" },
  { id: "needs_you", title: "Needs you" },
  { id: "submitted", title: "Submitted" },
  { id: "closed", title: "Closed" },
] as const;

export type ApplicationsTrackerBoardColumnId = (typeof APPLICATIONS_TRACKER_BOARD_COLUMNS)[number]["id"];

export function boardColumnForTrackerRow(row: ApplicationsTrackerRow): ApplicationsTrackerBoardColumnId {
  if (row.statusLabel === "Submitted") return "submitted";
  if (row.needsYouCount > 0 || row.filter === "needs_you") return "needs_you";
  if (row.filter === "failed" || row.filter === "skipped") return "closed";
  if (row.filter === "in_flight") return "in_flight";
  return "submitted";
}

export function ApplicationsTrackerBoard({ rows }: { rows: ApplicationsTrackerRow[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-4">
      {APPLICATIONS_TRACKER_BOARD_COLUMNS.map((column) => {
        const items = rows.filter((row) => boardColumnForTrackerRow(row) === column.id);
        return (
          <section key={column.id} className="rounded-2xl border border-line bg-[#fafbf8]/50 p-3 sm:p-4">
            <div className="flex items-baseline justify-between gap-2 px-1">
              <h2 className="text-sm font-semibold tracking-tight text-ink">{column.title}</h2>
              <p className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] text-ink-muted ring-1 ring-line">
                {items.length}
              </p>
            </div>
            {items.length === 0 ? (
              <p className="mt-4 px-1 text-sm text-ink-muted">None in this column.</p>
            ) : (
              <ul className="mt-3 grid gap-2.5">
                {items.map((row) => (
                  <li key={row.id}>
                    <ApplicationsTrackerBoardCard row={row} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
