import type { ApplicationStatus } from "@1apply/contracts";

import { StatusPill } from "@/components/ui/status-pill";
import { asOne, type ApplicationListRow } from "@/server/types";

const tones: Record<ApplicationStatus, "muted" | "sand" | "mint" | "teal" | "violet" | "coral"> = {
  draft: "muted",
  preparing: "sand",
  ready: "mint",
  submitted: "teal",
  assessment: "violet",
  interview: "violet",
  offer: "mint",
  rejected: "coral",
  withdrawn: "muted",
  archived: "muted",
};

export function applicationTone(status: ApplicationStatus) {
  return tones[status];
}

export function formatDeadline(value: string | null) {
  if (!value) return "No deadline";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}

export function ApplicationSummary({ row }: { row: ApplicationListRow }) {
  const opportunity = asOne(row.opportunities);
  const fit = asOne(row.fit_evaluations);

  return (
    <article className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">{opportunity?.title ?? "Untitled opportunity"}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {opportunity?.organization ?? "Unknown host"} · {formatDeadline(row.deadline_at)}
          </p>
        </div>
        <StatusPill tone={applicationTone(row.status)}>{row.status.replace("_", " ")}</StatusPill>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Fit Index</dt>
          <dd className="mt-1 font-mono text-xl">{fit ? fit.score : "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Next action</dt>
          <dd className="mt-1 text-ink-muted">{row.next_action ?? "Analyze this opportunity"}</dd>
        </div>
      </dl>
    </article>
  );
}
