"use client";

import { deleteDocument } from "@/server/documents/actions";
import { SubmitButton } from "@/components/ui/button";

export function DeleteDocumentButton({
  documentId,
  returnTo,
  label = "Delete",
  confirmMessage = "Delete this document permanently? Extracted facts from it will also be removed from Application Memory.",
}: {
  documentId: string;
  returnTo: string;
  label?: string;
  confirmMessage?: string;
}) {
  return (
    <form
      action={deleteDocument}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <SubmitButton variant="danger" size="sm" pendingText="Deleting…">
        {label}
      </SubmitButton>
    </form>
  );
}
