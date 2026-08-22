"use client";

import { ErrorState } from "@/components/ui/feedback";
import { WorkspaceMain } from "@/components/app/page-header";

export default function RouteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <WorkspaceMain>
      <ErrorState onRetry={reset} />
    </WorkspaceMain>
  );
}
