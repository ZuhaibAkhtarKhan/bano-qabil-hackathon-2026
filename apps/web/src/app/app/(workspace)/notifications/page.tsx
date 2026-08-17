import Link from "next/link";

import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { Timeline } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { StatusPill } from "@/components/ui/status-pill";
import { loadNotificationsWorkspace } from "@/server/workspace/queries";

export default async function NotificationsPage() {
  const { notifications } = await loadNotificationsWorkspace();
  const unread = notifications.filter((item) => !item.read_at).length;

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Notifications"
        title="What actually happened"
        body="Notices are written when a job, review item, or snapshot is recorded. This list is not a marketing feed."
      />
      {notifications.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            eyebrow="Quiet"
            title="No notifications yet"
            body="Analyze an opportunity, generate a draft, or freeze a snapshot. Activity appears only after those events."
          />
        </div>
      ) : (
        <div className="mt-8 max-w-2xl">
          <p className="mb-6 text-sm text-ink-muted">
            {unread} unread · {notifications.length} total
          </p>
          <Timeline
            items={notifications.map((item) => ({
              id: item.id,
              title: item.title,
              body: item.body,
              at: new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(item.created_at),
              ),
            }))}
          />
          <ul className="mt-8 grid gap-3">
            {notifications.map((item) => (
              <li key={`${item.id}-status`} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{item.title}</span>
                <span className="flex items-center gap-2">
                  <StatusPill tone={item.read_at ? "muted" : "sand"}>{item.read_at ? "Read" : "Unread"}</StatusPill>
                  {item.application_id ? (
                    <Link className="underline" href={`/app/applications/${item.application_id}`}>
                      Open
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WorkspaceMain>
  );
}
