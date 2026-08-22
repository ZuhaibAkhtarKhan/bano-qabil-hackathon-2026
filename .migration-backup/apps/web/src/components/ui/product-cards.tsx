import Link from "next/link";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { ScoreIndicator } from "@/components/ui/data";
import { SemanticBadge, StatusPill } from "@/components/ui/status-pill";
import { applicationHost, applicationTitle } from "@/lib/dashboard";
import { evidenceSemanticStatus } from "@/lib/status";
import { asOne, type ApplicationListRow, type DocumentListRow, type OpportunityListRow } from "@/server/types";
import { applicationTone, formatDeadline } from "@/components/app/application-summary";

export function DocumentCard({
  document,
  href,
}: {
  document: DocumentListRow;
  href?: string;
}) {
  const versions = document.document_versions ?? [];
  const current = versions.find((item) => item.id === document.current_version_id) ?? versions[0];
  const inner = (
    <Card as="article">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-base font-medium">{document.label}</h3>
        <StatusPill tone="muted">{document.type.replace("_", " ")}</StatusPill>
      </div>
      <p className="mt-2 text-sm text-ink-muted">
        {current
          ? `${current.version_label}${document.current_version_id === current.id ? " · latest" : ""} · ${current.status} · ${Math.round(current.byte_size / 1024)} KB`
          : "No version"}
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        {versions.length} version{versions.length === 1 ? "" : "s"} retained
      </p>
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function EvidenceCard({
  title,
  kind,
  organization,
  outcome,
  startDate,
  endDate,
  verificationStatus,
  excludedFromAi,
  extractionStatus,
  sourceLabel,
  sourceExcerpt,
  hasOpenConflict,
  actions,
}: {
  title: string;
  kind: string;
  organization: string | null;
  outcome: string | null;
  startDate?: string | null;
  endDate?: string | null;
  verificationStatus: "unverified" | "verified" | "rejected";
  excludedFromAi: boolean;
  extractionStatus?: "manual" | "extracted" | "user_edited";
  sourceLabel?: string | null;
  sourceExcerpt?: string | null;
  hasOpenConflict?: boolean;
  actions?: ReactNode;
}) {
  return (
    <Card as="article">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-base font-medium">{title}</h3>
        <SemanticBadge
          status={evidenceSemanticStatus({
            verificationStatus,
            excludedFromAi,
            extractionStatus,
            hasOpenConflict,
          })}
        />
      </div>
      <p className="mt-2 text-sm text-ink-muted">
        {kind}
        {organization ? ` · ${organization}` : ""}
        {startDate || endDate ? ` · ${startDate ?? "?"} → ${endDate ?? "present"}` : ""}
      </p>
      {outcome ? <p className="mt-2 text-sm">{outcome}</p> : null}
      {sourceLabel ? (
        <p className="mt-2 text-xs text-ink-muted">
          Source: {sourceLabel}
          {sourceExcerpt ? ` · "${sourceExcerpt.slice(0, 160)}"` : ""}
        </p>
      ) : null}
      {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
    </Card>
  );
}

export function OpportunityCard({
  opportunity,
  href,
}: {
  opportunity: OpportunityListRow;
  href?: string;
}) {
  const inner = (
    <Card as="article">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-base font-medium">{opportunity.title}</h3>
        <StatusPill tone="muted">{opportunity.analysis_status.replace("_", " ")}</StatusPill>
      </div>
      <p className="mt-2 text-sm text-ink-muted">
        {opportunity.organization ?? "Unknown host"} · {opportunity.category.replace(/_/g, " ")} · {opportunity.source}
        {opportunity.location ? ` · ${opportunity.location}` : ""}
      </p>
      {opportunity.deadline_at ? (
        <p className="mt-1 text-xs text-ink-muted">
          Deadline {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(opportunity.deadline_at))}
        </p>
      ) : null}
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function ApplicationCard({ row }: { row: ApplicationListRow }) {
  const fit = asOne(row.fit_evaluations);
  return (
    <Card as="article">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium">{applicationTitle(row)}</h3>
          <p className="mt-1 text-sm text-ink-muted">
            {applicationHost(row)} · {formatDeadline(row.deadline_at)}
          </p>
        </div>
        <StatusPill tone={applicationTone(row.status)}>{row.status.replace("_", " ")}</StatusPill>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <ScoreIndicator score={fit?.score ?? null} />
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Next action</p>
          <p className="mt-1 text-sm text-ink-muted">{row.next_action ?? "Analyze this opportunity"}</p>
        </div>
      </div>
    </Card>
  );
}
