"use client";

import { confirmNeedsYouEligibility } from "@/server/needs-you/actions";
import { SubmitButton } from "@/components/ui/button";

export function NeedsYouEligibilityConfirm({
  applicationId,
  eligibilityId,
}: {
  applicationId: string;
  eligibilityId: string;
}) {
  return (
    <form action={confirmNeedsYouEligibility} className="grid gap-2">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="eligibilityId" value={eligibilityId} />
      <SubmitButton pendingText="Saving…">Yes, I am eligible</SubmitButton>
      <p className="text-xs text-ink-muted">
        Confirms you meet this requirement. If the deadline passes without a response, 1-Apply will
        confirm eligibility automatically so prep can continue.
      </p>
    </form>
  );
}
