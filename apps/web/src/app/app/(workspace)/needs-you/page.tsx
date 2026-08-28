import { FlashBanner } from "@/components/app/flash-banner";
import { NeedsYouWorkspace } from "@/components/app/needs-you-workspace";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { requireWorkspace } from "@/server/auth/require-workspace";
import { refreshOpenApplicationsFromKit } from "@/server/applications/refresh-from-kit";
import { ensureOpenApplicationsResumeSelection } from "@/server/intelligence/auto-resume";
import { loadNeedsYouQueue } from "@/server/needs-you/queries";
import { normalizeApplicationStatus } from "@/lib/application-workflow";

export default async function NeedsYouPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const { supabase, actor, user } = await requireWorkspace();
  // Auto-fill kit-resolvable gaps (Full Name, phone, …) before rendering Need You.
  await refreshOpenApplicationsFromKit(supabase, actor).catch(() => null);

  const { data: applications } = await supabase
    .from("applications")
    .select("id, status")
    .eq("user_id", user.id);
  const openIds = (applications ?? [])
    .filter((row) =>
      ["saved", "analyzing", "ready_to_apply", "in_progress", "review_required", "draft", "preparing", "ready"].includes(
        normalizeApplicationStatus(row.status as Parameters<typeof normalizeApplicationStatus>[0]),
      ),
    )
    .map((row) => String(row.id));
  await ensureOpenApplicationsResumeSelection(supabase, actor, openIds);

  const data = await loadNeedsYouQueue();

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
