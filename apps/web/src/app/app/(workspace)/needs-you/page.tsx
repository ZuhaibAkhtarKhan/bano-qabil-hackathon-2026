import { FlashBanner } from "@/components/app/flash-banner";
import { NeedsYouWorkspace } from "@/components/app/needs-you-workspace";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { requireWorkspace } from "@/server/auth/require-workspace";
import { scheduleRefreshOpenApplicationsFromKit } from "@/server/applications/refresh-from-kit";
import { ensureOpenApplicationsResumeSelection } from "@/server/intelligence/auto-resume";
import { loadNeedsYouQueue } from "@/server/needs-you/queries";

export default async function NeedsYouPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const { supabase, actor } = await requireWorkspace();

  // Refresh kit-resolvable gaps in the background — do not block first paint.
  scheduleRefreshOpenApplicationsFromKit(supabase, actor);

  const data = await loadNeedsYouQueue({ polish: false });
  void ensureOpenApplicationsResumeSelection(supabase, actor, data.openApplicationIds).catch(() => null);

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Need You"
        title="Applications waiting on your input"
        body="Each row is an application that still needs something from you. Expand a row to answer fields, attach files, or clear walls like captcha and sign-on."
      />
      <FlashBanner notice={notice} error={error} />
      <NeedsYouWorkspace data={data} />
    </WorkspaceMain>
  );
}
