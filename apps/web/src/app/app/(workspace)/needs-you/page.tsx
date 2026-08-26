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
        title="Fill what Application Memory is missing"
        body="Questions, choices, documents, dates of birth, and other fields the platform cannot answer yet — grouped by the application that needs them. What you enter is stored in Application Memory, then that application continues in the background."
      />
      <FlashBanner notice={notice} error={error} />
      <NeedsYouWorkspace data={data} />
    </WorkspaceMain>
  );
}
