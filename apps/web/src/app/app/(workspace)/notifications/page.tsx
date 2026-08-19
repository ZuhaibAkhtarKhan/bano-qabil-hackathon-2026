import Link from "next/link";

import { FlashBanner } from "@/components/app/flash-banner";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { StatusPill } from "@/components/ui/status-pill";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
  runAutomationChecksAction,
} from "@/server/notifications/actions";
import { loadNotificationsWorkspace } from "@/server/workspace/queries";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const { notifications } = await loadNotificationsWorkspace();
  const unread = notifications.filter((item) => !item.read_at).length;

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Notifications"
        title="What actually happened"
        body="Notices come from domain events: deadlines, answers, submission, email, and calendar. Email copies are logged for audit unless a mail provider is added later."
        actions={
          <div className="flex flex-wrap gap-2">
            <form action={runAutomationChecksAction}>
              <Button type="submit" size="sm">
                Run checks
              </Button>
            </form>
            {unread > 0 ? (
              <form action={markAllNotificationsReadAction}>
                <Button type="submit" size="sm" variant="secondary">
                  Mark all read
                </Button>
              </form>
            ) : null}
          </div>
        }
      />
      <FlashBanner notice={notice} error={error} />
      {notifications.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            eyebrow="Quiet"
            title="No notifications yet"
            body="Analyze an opportunity, generate a draft, freeze a snapshot, or run checks. Activity appears only after those events."
          />
        </div>
      ) : (
        <div className="mt-8 max-w-2xl">
          <p className="mb-6 text-sm text-ink-muted">
            {unread} unread · {notifications.length} total
          </p>
          <ul className="grid gap-3">
            {notifications.map((item) => {
              const href = item.action_url || (item.application_id ? `/app/applications/${item.application_id}` : null);
              return (
                <li key={item.id} className="rounded-2xl border border-line bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="mt-1 text-sm text-ink-muted">{item.body}</p>
                      <p className="mt-2 text-xs text-ink-muted">
                        {item.category ? item.category.replace(/_/g, " ") : "notice"}
                        {typeof item.priority === "number" ? ` · priority ${item.priority}` : ""}
                        {" · "}
                        {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.created_at))}
                      </p>
                    </div>
                    <StatusPill tone={item.read_at ? "muted" : "sand"}>{item.read_at ? "Read" : "Unread"}</StatusPill>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-sm">
                    {href ? (
                      <Link className="underline" href={href}>
                        Open
                      </Link>
                    ) : null}
                    {!item.read_at ? (
                      <form action={markNotificationReadAction}>
                        <input type="hidden" name="notificationId" value={item.id} />
                        <button type="submit" className="underline">
                          Mark read
                        </button>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </WorkspaceMain>
  );
}
