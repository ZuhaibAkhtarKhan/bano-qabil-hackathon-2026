import type { ReactNode } from "react";
import Link from "next/link";

import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { ButtonLink } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/card";
import { Timeline } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { ApplicationCard, OpportunityCard } from "@/components/ui/product-cards";
import { dashboardBuckets } from "@/lib/dashboard";
import { loadDashboard } from "@/server/workspace/queries";

function Section({
  title,
  count,
  children,
  empty,
}: {
  title: string;
  count: number;
  children: ReactNode;
  empty: ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="flex items-end justify-between gap-3">
        <h2 className="font-display text-2xl">{title}</h2>
        <p className="font-mono text-xs text-ink-muted">{count}</p>
      </div>
      <div className="mt-4">{count === 0 ? empty : children}</div>
    </section>
  );
}

export default async function DashboardPage() {
  const { profile, completeness, verifiedEvidenceCount, documentCount, resumeCount, applications, notifications, opportunities } =
    await loadDashboard();
  const buckets = dashboardBuckets(applications);
  const applicationByOpportunity = new Map(applications.map((row) => [row.opportunity_id, row.id]));

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Dashboard"
        title={`Welcome${profile.display_name ? `, ${profile.display_name}` : ""}`}
        body="Your application operating system. Counts come from private memory — this screen never invents a pipeline."
        actions={<ButtonLink href="/app/opportunities">Add an opportunity</ButtonLink>}
      />

      <dl className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Memory" value={`${completeness.percent}%`} hint="Identity, consent, verified evidence, documents" />
        <MetricCard label="Active" value={buckets.active.length} hint="Saved, analyzing, ready, in progress, review required" />
        <MetricCard label="Evidence" value={verifiedEvidenceCount} hint={`${documentCount} files · ${resumeCount} resumes`} />
        <MetricCard label="Attention" value={buckets.attention.length + notifications.filter((item) => !item.read_at).length} hint="Reviews, missing facts, unread notices" />
      </dl>

      <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <div>
          <Section
            title="Attention required"
            count={buckets.attention.length}
            empty={
              <EmptyState
                eyebrow="Clear"
                title="Nothing needs you right now"
                body="Unclear eligibility, unverified evidence, and review items will appear here when they exist."
              />
            }
          >
            <ul className="grid gap-4">
              {buckets.attention.map((row) => (
                <li key={row.id}>
                  <Link href={`/app/applications/${row.id}`} className="block">
                    <ApplicationCard row={row} />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Deadlines"
            count={buckets.deadlines.length}
            empty={
              <p className="text-sm text-ink-muted">No upcoming deadlines on file.</p>
            }
          >
            <ul className="grid gap-4">
              {buckets.deadlines.map((row) => (
                <li key={row.id}>
                  <Link href={`/app/applications/${row.id}`} className="block">
                    <ApplicationCard row={row} />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Active applications"
            count={buckets.active.length}
            empty={
              <EmptyState
                eyebrow="Empty"
                title="No applications in progress"
                body="Paste a public opportunity URL or create one manually. Tracking starts after that."
                actions={<ButtonLink href="/app/opportunities">Open opportunities</ButtonLink>}
              />
            }
          >
            <ul className="grid gap-4">
              {buckets.active.map((row) => (
                <li key={row.id}>
                  <Link href={`/app/applications/${row.id}`} className="block">
                    <ApplicationCard row={row} />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            title="Recent applications"
            count={buckets.recent.length}
            empty={
              <EmptyState
                eyebrow="Empty"
                title="No application history yet"
                body="Recent work appears here after you create an opportunity and start a workspace."
              />
            }
          >
            <ul className="grid gap-4">
              {buckets.recent.map((row) => (
                <li key={row.id}>
                  <Link href={`/app/applications/${row.id}`} className="block">
                    <ApplicationCard row={row} />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <aside className="grid gap-8">
          <section>
            <h2 className="font-display text-2xl">Submitted</h2>
            <p className="mt-1 font-mono text-xs text-ink-muted">{buckets.submitted.length}</p>
            {buckets.submitted.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">No frozen snapshots yet.</p>
            ) : (
              <ul className="mt-4 grid gap-3">
                {buckets.submitted.slice(0, 4).map((row) => (
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
            <h2 className="font-display text-2xl">Interviews</h2>
            <p className="mt-1 font-mono text-xs text-ink-muted">{buckets.interviews.length}</p>
            {buckets.interviews.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">No under-review or interview stages recorded.</p>
            ) : (
              <ul className="mt-4 grid gap-3">
                {buckets.interviews.map((row) => (
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
            <h2 className="font-display text-2xl">Recent opportunities</h2>
            {opportunities.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">None ingested yet.</p>
            ) : (
              <ul className="mt-4 grid gap-3">
                {opportunities.map((item) => (
                  <li key={item.id}>
                    <OpportunityCard
                      opportunity={item}
                      href={
                        applicationByOpportunity.get(item.id)
                          ? `/app/applications/${applicationByOpportunity.get(item.id)}`
                          : "/app/opportunities"
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-display text-2xl">Activity</h2>
            {notifications.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">No notices yet. This list stays empty until something actually happens.</p>
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
