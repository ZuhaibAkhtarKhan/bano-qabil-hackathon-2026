import { asOne } from "@/server/types";
import { DashboardHome, type DashboardApplicationRow, type DashboardMatch } from "@/components/app/dashboard-home";
import {
  applicationTableMeta,
  companyFromOpportunity,
  dashboardDocumentStatuses,
  relativeTimeLabel,
  sourceLabelFromOpportunity,
} from "@/lib/dashboard-display";
import { loadDashboard } from "@/server/workspace/queries";

export const dynamic = "force-dynamic";

const MATCH_TONES = ["sand", "mint", "violet", "coral"] as const;

function fitScore(row: { fit_evaluations: { score: number } | { score: number }[] | null }) {
  const value = Array.isArray(row.fit_evaluations) ? row.fit_evaluations[0]?.score : row.fit_evaluations?.score;
  return typeof value === "number" ? value : null;
}

export default async function DashboardPage() {
  const { applications } = await loadDashboard();

  const scoredApps = applications
    .map((row) => ({ row, score: fitScore(row) }))
    .filter((item) => item.score != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const recentApps = applications.slice(0, 4);
  const matchSource: DashboardMatch[] = (scoredApps.length > 0 ? scoredApps.slice(0, 4) : recentApps.map((row) => ({ row, score: fitScore(row) })))
    .map(({ row, score }, index) => {
      const opportunity = asOne(row.opportunities);
      const company = companyFromOpportunity(opportunity);
      return {
        id: row.id,
        href: `/app/applications/${row.id}`,
        company,
        role: opportunity?.title ?? "Untitled role",
        match: score,
        tone: MATCH_TONES[index % MATCH_TONES.length]!,
        sourceLabel: sourceLabelFromOpportunity(opportunity),
      } satisfies DashboardMatch;
    });

  const tableRows: DashboardApplicationRow[] = applications.map((row) => {
    const opportunity = asOne(row.opportunities);
    const company = companyFromOpportunity(opportunity);
    const meta = applicationTableMeta(row.status, row.next_action);
    const docs = dashboardDocumentStatuses({
      requiredLabels: row.requiredDocumentLabels ?? [],
      attachedLabels: row.attachedDocumentLabels ?? [],
    });
    return {
      id: row.id,
      href: `/app/applications/${row.id}`,
      company,
      role: opportunity?.title ?? "Untitled opportunity",
      resume: docs.resume,
      cover: docs.cover,
      statusLabel: meta.statusLabel,
      statusTone: meta.statusTone,
      filter: meta.filter,
      appliedLabel: relativeTimeLabel(row.submitted_at, row.updated_at),
      initial: company.slice(0, 2).toUpperCase(),
      sourceLabel: sourceLabelFromOpportunity(opportunity),
    };
  });

  return (
    <main id="main">
      <DashboardHome matches={matchSource} applications={tableRows} />
    </main>
  );
}
