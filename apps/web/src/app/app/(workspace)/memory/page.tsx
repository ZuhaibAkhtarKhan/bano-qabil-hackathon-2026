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
        eyebrow="Application Memory"
        title="Who you are — traceable to sources"
        body="Upload resumes, review extracted facts, verify what is true, and resolve conflicts when documents disagree. Nothing extracted is treated as verified until you confirm it."
      />
      <FlashBanner notice={notice} error={error} />
      <MemoryWorkspace data={data} section={section} />
    </WorkspaceMain>
  );
}
