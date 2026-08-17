import Link from "next/link";

import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { ApplicationCard } from "@/components/ui/product-cards";
import { loadApplicationsWorkspace } from "@/server/workspace/queries";

export default async function ApplicationsPage() {
  const { applications } = await loadApplicationsWorkspace();

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Applications"
        title="Track what you actually prepared"
        body="Statuses and snapshots come from your rows. Nothing is seeded for a demo."
        actions={<ButtonLink href="/app/opportunities">New opportunity</ButtonLink>}
      />
      {applications.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            eyebrow="Empty"
            title="No applications to track"
            body="Create an opportunity first. History stays empty until you do."
          />
        </div>
      ) : (
        <ul className="mt-8 grid max-w-3xl gap-4">
          {applications.map((row) => (
            <li key={row.id}>
              <Link href={`/app/applications/${row.id}`} className="block">
                <ApplicationCard row={row} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WorkspaceMain>
  );
}
