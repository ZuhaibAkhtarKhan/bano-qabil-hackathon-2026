import type { ReactNode } from "react";
import Link from "next/link";

import { currentGuideStep, nextGuideSteps } from "@1apply/domain";

import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { WorkspaceGuideCard } from "@/components/app/workspace-guide";
import { ButtonLink } from "@/components/ui/button";
import { Card, MetricCard } from "@/components/ui/card";
import { Timeline } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { ApplicationCard } from "@/components/ui/product-cards";
import { groupPackets } from "@/lib/dashboard";
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

/** Packet / kit dashboard from saadia — preserved during branch merge. */
export async function DashboardPackets() {
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

      <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <div>
          <Section
            title="Needs you"
            count={lanes.needsYou.length}
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
