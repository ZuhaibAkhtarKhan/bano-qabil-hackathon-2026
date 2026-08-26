import type { MemoryCategory } from "@1apply/contracts";
import { memoryCategorySchema } from "@1apply/contracts";
import Link from "next/link";

import { FlashBanner } from "@/components/app/flash-banner";
import { MemoryWorkspace } from "@/components/app/memory-workspace";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { Notice } from "@/components/ui/feedback";
import { kitStatus } from "@1apply/domain";
import { parseWorkspacePreferences } from "@/lib/workspace-preferences";
import { loadMemoryWorkspace } from "@/server/memory/queries";

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; section?: string; remind?: string }>;
}) {
  const { notice, error, section: rawSection, remind } = await searchParams;
  const sectionParsed = memoryCategorySchema.safeParse(rawSection ?? "personal");
  const section: MemoryCategory = sectionParsed.success ? sectionParsed.data : "personal";
  const data = await loadMemoryWorkspace();
  const prefs = parseWorkspacePreferences(data.preferences);
  const kit = kitStatus({
    displayName: data.profile.display_name,
    university: prefs.university,
    educationSummary: prefs.educationSummary,
    documents: data.documents,
  });

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Your kit"
        title="Who you are — reused on every posting"
        body="Confirm name, university, and education. Upload CNIC, B-form, and categorized resumes once — same category later becomes the next version. Suggestions later are optional."
      />
      {remind === "kit" && kit.missing.length > 0 ? (
        <div className="mt-6">
          <Notice tone="coral">
            Finish the required kit so later postings can reuse it. Still missing: {kit.missing.join(", ")}. You can
            keep using the dashboard, and we will remind you again the next time you sign in.
            {" "}
            <Link className="underline" href="/app">
              Continue to dashboard
            </Link>
          </Notice>
        </div>
      ) : null}
      <FlashBanner notice={notice} error={error} />
      <MemoryWorkspace data={data} section={section} />
    </WorkspaceMain>
  );
}
