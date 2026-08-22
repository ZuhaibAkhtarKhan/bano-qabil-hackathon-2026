import { PageSkeleton } from "@/components/ui/feedback";
import { WorkspaceMain } from "@/components/app/page-header";

export default function RouteLoading() {
  return (
    <WorkspaceMain>
      <PageSkeleton />
    </WorkspaceMain>
  );
}
