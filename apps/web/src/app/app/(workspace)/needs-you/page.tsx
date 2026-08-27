import { FlashBanner } from "@/components/app/flash-banner";
import { NeedsYouWorkspace } from "@/components/app/needs-you-workspace";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { loadNeedsYouQueue } from "@/server/needs-you/queries";

export default async function NeedsYouPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const data = await loadNeedsYouQueue();

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Need You"
        title="Answer what this application still needs"
        body="For each question, save the answer into Application Memory for every future packet, or fill it only for this application."
      />
      <FlashBanner notice={notice} error={error} />
      <NeedsYouWorkspace data={data} />
    </WorkspaceMain>
  );
}
