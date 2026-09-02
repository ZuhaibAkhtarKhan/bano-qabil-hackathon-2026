"use client";

import { confirmNeedsYouEligibility } from "@/server/needs-you/actions";
import { useNeedsYouSave } from "@/components/app/needs-you-save-hook";
import { SubmitButton } from "@/components/ui/button";

export function NeedsYouEligibilityConfirm({
  applicationId,
  eligibilityId,
  itemId,
}: {
  applicationId: string;
  eligibilityId: string;
  itemId: string;
}) {
  const { isPending, feedbackNotice, handleSubmit } = useNeedsYouSave({ itemId });

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => handleSubmit(event, confirmNeedsYouEligibility)}
    >
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="eligibilityId" value={eligibilityId} />
      {feedbackNotice}
      <SubmitButton pending={isPending} pendingText="Saving…">
        Yes, I am eligible
      </SubmitButton>
      <p className="text-xs text-ink-muted">
        Confirms you meet this requirement. If the deadline passes without a response, 1-Apply will
        confirm eligibility automatically so prep can continue.
      </p>
    </form>
  );
}
