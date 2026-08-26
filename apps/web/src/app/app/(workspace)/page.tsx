import type { ReactNode } from "react";
import Link from "next/link";

import { currentGuideStep, nextGuideSteps } from "@1apply/domain";

import { DashboardHome, type DashboardApplicationRow, type DashboardMatch } from "@/components/app/dashboard-home";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { WorkspaceGuideCard } from "@/components/app/workspace-guide";
import { ButtonLink } from "@/components/ui/button";
import { Card, MetricCard } from "@/components/ui/card";
import { Timeline } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { ApplicationCard } from "@/components/ui/product-cards";
import { groupPackets } from "@/lib/dashboard";
import {
  applicationTableMeta,
  companyFromOpportunity,
  dashboardDocumentStatuses,
  relativeTimeLabel,
  sourceLabelFromOpportunity,
} from "@/lib/dashboard-display";
import { asOne } from "@/server/types";
import { loadDashboard } from "@/server/workspace/queries";

export const dynamic = "force-dynamic";

const MATCH_TONES = ["sand", "mint", "violet", "coral"] as const;

function fitScore(row: { fit_evaluations: { score: number } | { score: number }[] | null }) {
  const value = Array.isArray(row.fit_evaluations) ? row.fit_evaluations[0]?.score : row.fit_evaluations?.score;
  return typeof value === "number" ? value : null;
}

function Section({
  title,
  count,
  children,
  empty,
  action,
}: {
  title: string;
  count: number;
  children: ReactNode;
  empty: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="flex items-end justify-between gap-3">
        <h2 className="font-display text-2xl">{title}</h2>
        <div className="flex items-center gap-3">
          {action}
          <p className="font-mono text-xs text-ink-muted">{count}</p>
        </div>
      </div>
      <div className="mt-4">{count === 0 ? empty : children}</div>
    </section>
  );
}

export default async function DashboardPage() {
  const { profile, kit, packets, notifications, applications, opportunities, prepareAndSendIfSilent, guideDismissed } =
    await loadDashboard();
  const lanes = groupPackets(packets);
  const submitted = applications.filter((row) => row.status === "submitted");
  const guideSteps = nextGuideSteps({
    kitMissing: kit.missing,
    opportunityCount: opportunities.length,
    applicationCount: applications.length,
    needsYouCount: lanes.needsYou.length,
    prepareAndSendIfSilent,
  });
  const showKitCard = (!kit.ready || kit.missing.length > 0) && (guideDismissed || currentGuideStep(guideSteps)?.id !== "kit");

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
    <WorkspaceMain>
      <PageHeader
        eyebrow="Dashboard"
        title={kit.ready ? `Welcome${profile.display_name ? `, ${profile.display_name}` : ""}` : "Finish your kit, then watch deadlines"}
        body="This is the home for pending packets. Add a posting only when you have a URL. Extra editors live under Your kit and Settings."
        actions={<ButtonLink href="/app/opportunities">Add a posting</ButtonLink>}
      />

      <WorkspaceGuideCard dismissed={guideDismissed} steps={guideSteps} />

      {showKitCard ? (
        <Card className="mt-8 p-6">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Your kit</p>
          <h2 className="mt-1 font-display text-2xl">Upload once, reuse everywhere</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Name, university, resume, CNIC, and B-form live in one place. Missing: {kit.missing.join(", ") || "nothing"}.
          </p>
          <div className="mt-4">
            <ButtonLink href="/app/memory">Open your kit</ButtonLink>
          </div>
        </Card>
      ) : null}

      <dl className="mt-10 grid gap-4 sm:grid-cols-3">
        <MetricCard label="Needs you" value={lanes.needsYou.length} hint="Missing facts, docs, or answers" />
        <MetricCard
          label="Sends at deadline"
          value={lanes.sendsAtDeadline.length}
          hint={prepareAndSendIfSilent ? "Silence will freeze the packet" : "Turn on in Settings to auto-freeze"}
        />
        <MetricCard label="Waiting on host" value={lanes.waitingHost.length} hint="CAPTCHA, signature, or payment" />
      </dl>

      <div className="mt-10">
        <DashboardHome matches={matchSource} applications={tableRows} showChrome={false} />
      </div>

      <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <div>
          <Section
            title="Needs you"
            count={lanes.needsYou.length}
            action={
              <Link href="/app/needs-you" className="text-xs font-medium text-ink-muted underline">
                Open Need You
              </Link>
            }
            empty={
              <EmptyState
                eyebrow="Clear"
                title="Nothing needs you right now"
                body="Missing kit items, unanswered questions, and unmatched documents appear here."
              />
            }
          >
            <ul className="grid gap-4">
              {lanes.needsYou.map((packet) => (
                <li key={packet.id}>
                  <Link href={`/app/applications/${packet.id}`} className="block">
                    <Card className="p-5">
                      <p className="text-sm font-medium">{packet.title}</p>
                      <p className="mt-1 text-xs text-ink-muted">{packet.host} · {packet.deadlineLabel}</p>
                      <p className="mt-2 text-sm text-ink-muted">{packet.summary}</p>
                      {packet.missingDocs.length > 0 ? (
                        <p className="mt-2 text-xs text-coral">Missing: {packet.missingDocs.join(", ")}</p>
                      ) : null}
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Sends at deadline unless you edit"
            count={lanes.sendsAtDeadline.length}
            empty={
              <p className="text-sm text-ink-muted">
                {prepareAndSendIfSilent
                  ? "No complete packets waiting on a deadline."
                  : "Opt in under Settings if you want 1-Apply to freeze a packet when you stay silent."}
              </p>
            }
          >
            <ul className="grid gap-4">
              {lanes.sendsAtDeadline.map((packet) => (
                <li key={packet.id}>
                  <Link href={`/app/applications/${packet.id}`} className="block">
                    <Card className="p-5">
                      <p className="text-sm font-medium">{packet.title}</p>
                      <p className="mt-1 text-xs text-ink-muted">{packet.host} · {packet.deadlineLabel}</p>
                      <p className="mt-2 text-sm">{packet.summary}</p>
                      <p className="mt-2 text-xs text-ink-muted">
                        Suggestions stay editable until the deadline. 1-Apply will not click host Submit.
                      </p>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Waiting on host / CAPTCHA"
            count={lanes.waitingHost.length}
            empty={<p className="text-sm text-ink-muted">No packets paused on CAPTCHA, signature, or payment.</p>}
          >
            <ul className="grid gap-4">
              {lanes.waitingHost.map((packet) => (
                <li key={packet.id}>
                  <Link href={`/app/applications/${packet.id}`} className="block">
                    <Card className="p-5">
                      <p className="text-sm font-medium">{packet.title}</p>
                      <p className="mt-1 text-xs text-ink-muted">{packet.host} · {packet.deadlineLabel}</p>
                      <p className="mt-2 text-sm text-ink-muted">Complete the host challenge yourself. 1-Apply never bypasses it.</p>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <aside className="grid gap-8">
          <section>
            <h2 className="font-display text-2xl">Frozen packets</h2>
            <p className="mt-1 font-mono text-xs text-ink-muted">{submitted.length}</p>
            {submitted.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">No snapshots yet.</p>
            ) : (
              <ul className="mt-4 grid gap-3">
                {submitted.slice(0, 4).map((row) => (
                  <li key={row.id}>
                    <Link href={`/app/applications/${row.id}`} className="block">
                      <ApplicationCard row={row} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-display text-2xl">Activity</h2>
            {notifications.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">No notices yet.</p>
            ) : (
              <div className="mt-4">
                <Timeline
                  items={notifications.map((item) => ({
                    id: item.id,
                    title: item.title,
                    body: item.body,
                    at: new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(item.created_at)),
                  }))}
                />
              </div>
            )}
          </section>
        </aside>
      </div>
    </WorkspaceMain>
  );
}
