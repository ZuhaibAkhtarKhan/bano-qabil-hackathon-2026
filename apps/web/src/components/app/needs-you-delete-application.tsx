"use client";

import { deleteApplication } from "@/server/applications/actions";
import { SubmitButton } from "@/components/ui/button";

export function NeedsYouDeleteApplication({ applicationId }: { applicationId: string }) {
  return (
    <form
      action={deleteApplication}
      className="mt-4 border-t border-line pt-4"
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Remove this application and its saved posting? Use this if you are not eligible and do not want to continue.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="next" value="/app/needs-you" />
      <SubmitButton variant="secondary" pendingText="Removing…">
        Not eligible — delete application
      </SubmitButton>
      <p className="mt-2 text-xs text-ink-muted">
        Deletes this application and its Opportunities listing. Your kit is kept.
      </p>
    </form>
  );
}
