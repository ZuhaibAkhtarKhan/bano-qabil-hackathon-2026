"use client";

import { deleteApplicationAction } from "@/server/applications/actions";
import { useNeedsYouSave } from "@/components/app/needs-you-save-hook";
import { SubmitButton } from "@/components/ui/button";

export function NeedsYouDeleteApplication({
  applicationId,
  itemId,
}: {
  applicationId: string;
  itemId: string;
}) {
  const { isPending, feedbackNotice, handleSubmit } = useNeedsYouSave({
    itemId,
    applicationId,
  });

  return (
    <form
      className="mt-4 border-t border-line pt-4"
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Remove this application and its saved posting? Use this if you are not eligible and do not want to continue.",
          )
        ) {
          event.preventDefault();
          return;
        }
        handleSubmit(event, deleteApplicationAction, "application");
      }}
    >
      <input type="hidden" name="applicationId" value={applicationId} />
      {feedbackNotice}
      <SubmitButton variant="secondary" pending={isPending} pendingText="Removing…">
        Not eligible — delete application
      </SubmitButton>
      <p className="mt-2 text-xs text-ink-muted">
        Deletes this application and its Opportunities listing. Your kit is kept.
      </p>
    </form>
  );
}
