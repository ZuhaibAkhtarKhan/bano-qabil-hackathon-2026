import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";

export default function ApplicationNotFound() {
  return (
    <WorkspaceMain>
      <PageHeader eyebrow="Applications" title="Not found" />
      <div className="mt-10">
        <EmptyState
          eyebrow="Missing"
          title="This workspace is not in your account"
          body="The application id is invalid, or it belongs to someone else. Nothing was submitted."
          actions={<ButtonLink href="/app/applications">Back to applications</ButtonLink>}
        />
      </div>
    </WorkspaceMain>
  );
}
