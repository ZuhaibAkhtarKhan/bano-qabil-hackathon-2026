"use client";

import { deleteDocumentVersion } from "@/server/documents/actions";
import { SubmitButton } from "@/components/ui/button";

export function DeleteDocumentVersionButton({
  versionId,
  returnTo,
  label = "Delete",
  confirmMessage = "Delete this version permanently? Application attachments using it will be removed.",
}: {
  versionId: string;
  returnTo: string;
  label?: string;
  confirmMessage?: string;
}) {
  return (
    <form
      action={deleteDocumentVersion}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <SubmitButton variant="danger" size="sm" pendingText="Deleting…">
        {label}
      </SubmitButton>
    </form>
  );
}
