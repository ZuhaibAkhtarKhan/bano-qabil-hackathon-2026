import { currentGuideStep, nextGuideSteps } from "@1apply/domain";

import { asOne } from "@/server/types";
import { DashboardHome, type DashboardApplicationRow, type DashboardMatch } from "@/components/app/dashboard-home";
import {
  applicationTableMeta,
  companyFromOpportunity,
  dashboardDocumentStatuses,
  relativeTimeLabel,
  sourceLabelFromOpportunity,
} from "@/lib/dashboard-display";
import { groupPackets } from "@/lib/dashboard";
import { loadDashboard } from "@/server/workspace/queries";

export const dynamic = "force-dynamic";

const MATCH_TONES = ["sand", "mint", "violet", "coral"] as const;

function fitScore(row: { fit_evaluations: { score: number } | { score: number }[] | null }) {
  const value = Array.isArray(row.fit_evaluations) ? row.fit_evaluations[0]?.score : row.fit_evaluations?.score;
  return typeof value === "number" ? value : null;
}

/**
 * Zuhaib dashboard UI + Saadia kit/guide/packet options integrated in-page.
 * Full Saadia-only layout remains at `@/components/app/dashboard-packets`.
 */
export default async function DashboardPage() {
  const {
    profile,
    applications,
    opportunities,
    kit,
    packets,
    prepareAndSendIfSilent,
    guideDismissed,
  } = await loadDashboard();

  const lanes = groupPackets(packets);
  const guideSteps = nextGuideSteps({
    kitMissing: kit.missing,
    opportunityCount: opportunities.length,
    applicationCount: applications.length,
    needsYouCount: lanes.needsYou.length,
    prepareAndSendIfSilent,
  });
  const showKitCard =
    (!kit.ready || kit.missing.length > 0) && (guideDismissed || currentGuideStep(guideSteps)?.id !== "kit");

  const scoredApps = applications
    .map((row) => ({ row, score: fitScore(row) }))
    .filter((item) => item.score != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const recentApps = applications.slice(0, 4);
  const matchSource: DashboardMatch[] = (
    scoredApps.length > 0 ? scoredApps.slice(0, 4) : recentApps.map((row) => ({ row, score: fitScore(row) }))
  ).map(({ row, score }, index) => {
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
      <DashboardHome
        matches={matchSource}
        applications={tableRows}
        displayName={profile.display_name}
        kit={{
          ready: kit.ready,
          missing: kit.missing,
          showCard: showKitCard,
        }}
        guide={{
          dismissed: guideDismissed,
          steps: guideSteps,
        }}
        lanes={{
          needsYou: lanes.needsYou.length,
          sendsAtDeadline: lanes.sendsAtDeadline.length,
          waitingHost: lanes.waitingHost.length,
          prepareAndSendIfSilent,
          needsYouPreview: lanes.needsYou.slice(0, 3).map((packet) => ({
            id: packet.id,
            title: packet.title,
            host: packet.host,
            deadlineLabel: packet.deadlineLabel,
            summary: packet.summary,
            href: `/app/applications/${packet.id}`,
          })),
        }}
      />
    </main>
  );
}
