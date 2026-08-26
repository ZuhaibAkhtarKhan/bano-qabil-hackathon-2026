import type { MemoryCategory } from "@1apply/contracts";
import { memoryCategorySchema } from "@1apply/contracts";

import { FlashBanner } from "@/components/app/flash-banner";
import { MemoryWorkspace } from "@/components/app/memory-workspace";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { loadMemoryWorkspace } from "@/server/memory/queries";

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; section?: string }>;
}) {
  const { notice, error, section: rawSection } = await searchParams;
  const sectionParsed = memoryCategorySchema.safeParse(rawSection ?? "personal");
  const section: MemoryCategory = sectionParsed.success ? sectionParsed.data : "personal";
  const data = await loadMemoryWorkspace();

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Your kit"
        title="Who you are — reused on every posting"
        body="Confirm name, university, and education. Upload CNIC, B-form, and resume once. Suggestions later are optional. Extra sections below are for details, not a second home."
      />
      <FlashBanner notice={notice} error={error} />
      <MemoryWorkspace data={data} section={section} />
    </WorkspaceMain>
  );
}
