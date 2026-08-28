import Link from "next/link";

import { cn } from "@/lib/cn";
import type { OpportunityListRow } from "@/server/types";
import { sourceLabelFromOpportunity } from "@/lib/dashboard-display";

const STATUS_DOT = {
  mint: "bg-emerald-500",
  teal: "bg-cyan-500",
  coral: "bg-rose-500",
  sand: "bg-amber-500",
  muted: "bg-zinc-400",
} as const;

function analysisMeta(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("ready") || normalized === "analyzed") {
    return { label: "Analyzed", tone: "mint" as const };
  }
  if (normalized.includes("fail") || normalized.includes("error")) {
    return { label: "Failed", tone: "coral" as const };
  }
  if (normalized.includes("pending") || normalized.includes("processing") || normalized.includes("analyz")) {
    return { label: "Analyzing", tone: "teal" as const };
  }
  return { label: status.replace(/_/g, " "), tone: "muted" as const };
}

export type OpportunitiesTrackerRow = {
  id: string;
  href: string;
  company: string;
  role: string;
  category: string;
  location: string | null;
  sourceLabel: string | null;
  statusLabel: string;
  statusTone: keyof typeof STATUS_DOT;
  deadlineLabel: string;
  applicationHref: string | null;
  initial: string;
};

export function toOpportunitiesTrackerRow(
  opportunity: OpportunityListRow,
  application: { id: string } | null | undefined,
): OpportunitiesTrackerRow {
  const company = opportunity.organization?.trim() || "Unknown organization";
  const meta = analysisMeta(opportunity.analysis_status);
  const deadlineLabel = opportunity.deadline_at
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(opportunity.deadline_at))
    : "—";
  return {
    id: opportunity.id,
    href: `/app/opportunities/${opportunity.id}`,
    company,
    role: opportunity.title?.trim() || "Untitled opportunity",
    category: opportunity.category.replace(/_/g, " "),
    location: opportunity.location,
    sourceLabel: sourceLabelFromOpportunity(opportunity),
    statusLabel: meta.label,
    statusTone: meta.tone,
    deadlineLabel,
    applicationHref: application ? `/app/applications/${application.id}` : null,
    initial: company.slice(0, 2).toUpperCase(),
  };
}

/** Table aligned with Dashboard → All applications styling. */
export function OpportunitiesTrackerTable({ rows }: { rows: OpportunitiesTrackerRow[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[720px] table-fixed text-left text-sm">
        <thead className="border-b border-line bg-[#fafbf8] text-[11px] uppercase tracking-wider text-ink-muted">
          <tr>
            <th className="w-[34%] px-4 py-3 font-medium">Posting</th>
            <th className="w-[14%] px-4 py-3 font-medium">Type</th>
            <th className="w-[18%] px-4 py-3 font-medium">Status</th>
            <th className="w-[16%] px-4 py-3 font-medium">Deadline</th>
            <th className="w-[18%] px-4 py-3 font-medium">Open</th>
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
                    {row.location ? (
                      <span className="mt-0.5 block truncate text-[11px] text-ink-muted">{row.location}</span>
                    ) : null}
                  </span>
                </Link>
              </td>
              <td className="px-4 py-3.5 text-xs capitalize text-ink-muted">{row.category}</td>
              <td className="px-4 py-3.5">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[row.statusTone])} aria-hidden="true" />
                  <span className="truncate">{row.statusLabel}</span>
                </span>
              </td>
              <td className="px-4 py-3.5 text-xs text-ink-muted">{row.deadlineLabel}</td>
              <td className="px-4 py-3.5 text-xs">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <Link href={row.href} className="font-medium text-ink hover:underline">
                    Analysis
                  </Link>
                  {row.applicationHref ? (
                    <Link href={row.applicationHref} className="font-medium text-ink-muted hover:text-ink hover:underline">
                      Application
                    </Link>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
