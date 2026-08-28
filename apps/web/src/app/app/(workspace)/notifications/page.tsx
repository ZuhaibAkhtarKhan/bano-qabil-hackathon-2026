import { FlashBanner } from "@/components/app/flash-banner";
import { NotificationsInbox } from "@/components/app/notifications-inbox";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { SubmitButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { markAllNotificationsReadAction, runAutomationChecksAction } from "@/server/notifications/actions";
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
              <SubmitButton size="sm" pendingText="Running checks…">
                Run checks
              </SubmitButton>
            </form>
            {unread > 0 ? (
              <form action={markAllNotificationsReadAction}>
                <SubmitButton size="sm" variant="secondary">
                  Mark all read
                </SubmitButton>
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
        <NotificationsInbox notifications={notifications} />
      )}
    </WorkspaceMain>
  );
}
