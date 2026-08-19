import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { SemanticBadge } from "@/components/ui/status-pill";
import { loadIntegrationsWorkspace } from "@/server/workspace/queries";
import { loadAppConfig } from "@/config/env";
import {
  connectGmail,
  connectCalendar,
  disconnectIntegration,
  triggerGmailSync,
  confirmCalendarEvent,
} from "@/server/integrations/actions";

const EMAIL_CATEGORY_LABELS: Record<string, string> = {
  application_received: "Application received",
  interview_invitation: "Interview invitation",
  assessment: "Assessment",
  rejection: "Rejection",
  offer: "Offer",
  follow_up_request: "Follow-up request",
};

const EMAIL_CATEGORY_TONES: Record<string, "mint" | "coral" | "sand" | "muted"> = {
  offer: "mint",
  interview_invitation: "mint",
  rejection: "coral",
  assessment: "sand",
  application_received: "sand",
  follow_up_request: "sand",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { integrations, emailEvents, calendarEvents } = await loadIntegrationsWorkspace();
  const cfg = loadAppConfig();

  const gmailIntegration = integrations.find((i) => i.kind === "gmail");
  const calendarIntegration = integrations.find((i) => i.kind === "google_calendar");
  const pendingCalendarEvents = calendarEvents.filter((e) => !e.confirmed);

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Integrations"
        title="Connected accounts"
        body="Gmail and Google Calendar stay disconnected until you authorize them. No passwords are ever stored. Revoke access at any time."
      />

      {error && (
        <div className="mt-4 rounded-lg border border-coral-200 bg-coral-50 p-3 text-sm text-coral-800">
          {error === "oauth_not_configured"
            ? "Google OAuth is not configured on this deployment. Contact the administrator."
            : error === "not_connected"
              ? "Integration is not connected."
              : `Error: ${error.replace(/_/g, " ")}`}
        </div>
      )}

      {/* ── Connections ─────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Connections</h2>
        <ul className="mt-4 grid max-w-2xl gap-4">
          {/* Gmail */}
          <li>
            <Card as="article">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-medium">Gmail</h3>
                  <p className="mt-1 text-sm text-ink-muted">
                    {gmailIntegration
                      ? `Connected as ${gmailIntegration.account_label ?? "unknown"}`
                      : "Not connected · read-only, application emails only"}
                  </p>
                </div>
                {gmailIntegration && (
                  <SemanticBadge
                    status={
                      gmailIntegration.status === "connected"
                        ? "verified"
                        : gmailIntegration.status === "revoked"
                          ? "rejected"
                          : "failed"
                    }
                  />
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {gmailIntegration?.status === "connected" ? (
                  <>
                    <form action={triggerGmailSync}>
                      <input type="hidden" name="integrationId" value={gmailIntegration.id} />
                      <Button type="submit" variant="secondary" size="sm">
                        Sync now
                      </Button>
                    </form>
                    <form action={disconnectIntegration}>
                      <input type="hidden" name="integrationId" value={gmailIntegration.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Disconnect
                      </Button>
                    </form>
                  </>
                ) : cfg.googleOAuthConfigured ? (
                  <form action={connectGmail}>
                    <Button type="submit" variant="primary" size="sm">
                      Connect Gmail
                    </Button>
                  </form>
                ) : (
                  <p className="text-sm text-ink-muted">Google OAuth not configured on this deployment.</p>
                )}
              </div>
            </Card>
          </li>

          {/* Google Calendar */}
          <li>
            <Card as="article">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-medium">Google Calendar</h3>
                  <p className="mt-1 text-sm text-ink-muted">
                    {calendarIntegration
                      ? `Connected as ${calendarIntegration.account_label ?? "unknown"}`
                      : "Not connected · events are never created without your confirmation"}
                  </p>
                </div>
                {calendarIntegration && (
                  <SemanticBadge
                    status={
                      calendarIntegration.status === "connected"
                        ? "verified"
                        : calendarIntegration.status === "revoked"
                          ? "rejected"
                          : "failed"
                    }
                  />
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {calendarIntegration?.status === "connected" ? (
                  <form action={disconnectIntegration}>
                    <input type="hidden" name="integrationId" value={calendarIntegration.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Disconnect
                    </Button>
                  </form>
                ) : cfg.googleOAuthConfigured ? (
                  <form action={connectCalendar}>
                    <Button type="submit" variant="primary" size="sm">
                      Connect Calendar
                    </Button>
                  </form>
                ) : (
                  <p className="text-sm text-ink-muted">Google OAuth not configured.</p>
                )}
              </div>
            </Card>
          </li>
        </ul>
      </section>

      {/* ── Pending calendar confirmations ──────────────────────────── */}
      {pendingCalendarEvents.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Interviews awaiting confirmation ({pendingCalendarEvents.length})
          </h2>
          <ul className="mt-4 grid max-w-2xl gap-4">
            {pendingCalendarEvents.map((ev) => (
              <li key={ev.id}>
                <Card as="article" className="border-sand-300 bg-sand-50">
                  <h3 className="font-medium">{ev.title}</h3>
                  <p className="mt-1 text-sm text-ink-muted">
                    {formatDate(ev.starts_at)}
                    {ev.timezone ? ` (${ev.timezone})` : ""}
                    {ev.location ? ` · ${ev.location}` : ""}
                    {ev.meeting_url ? (
                      <>
                        {" · "}
                        <a href={ev.meeting_url} target="_blank" rel="noopener noreferrer" className="underline">
                          Join link
                        </a>
                      </>
                    ) : null}
                  </p>
                  {ev.notes && <p className="mt-2 text-xs text-ink-muted">{ev.notes}</p>}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {calendarIntegration?.status === "connected" ? (
                      <form action={confirmCalendarEvent}>
                        <input type="hidden" name="calendarEventId" value={ev.id} />
                        <Button type="submit" variant="primary" size="sm">
                          Add to Google Calendar
                        </Button>
                      </form>
                    ) : (
                      <p className="text-sm text-ink-muted">Connect Google Calendar to confirm.</p>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Email timeline ──────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Email timeline
        </h2>
        {emailEvents.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              eyebrow="No emails yet"
              title="No application emails detected"
              body="Connect Gmail and trigger a sync. Only emails relevant to your applications are stored."
            />
          </div>
        ) : (
          <ul className="mt-4 max-w-2xl divide-y divide-border">
            {emailEvents.map((ev) => {
              const tone = EMAIL_CATEGORY_TONES[ev.event_kind] ?? "muted";
              const label = EMAIL_CATEGORY_LABELS[ev.event_kind] ?? ev.event_kind;
              return (
                <li key={ev.id} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {ev.subject ?? "(no subject)"}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {ev.sender_domain ?? ev.from_address ?? "unknown sender"} ·{" "}
                        {formatDate(ev.occurred_at)}
                        {ev.user_corrected ? " · corrected by you" : ""}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                        tone === "mint"
                          ? "bg-mint-100 text-mint-800"
                          : tone === "coral"
                            ? "bg-coral-100 text-coral-800"
                            : tone === "sand"
                              ? "bg-sand-100 text-sand-800"
                              : "bg-surface-2 text-ink-muted"
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                  {ev.association_confidence !== null && (
                    <p className="mt-1 text-xs text-ink-muted">
                      {ev.application_id
                        ? `Associated with application (${Math.round(ev.association_confidence * 100)}% confidence)`
                        : "Not associated with any application"}
                    </p>
                  )}
                  {ev.interview_detected && (
                    <p className="mt-1 text-xs font-medium text-mint-700">Interview detected</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </WorkspaceMain>
  );
}
