import { verifyAllExtractedEvidence, verifyOnboardingEvidence } from "@/app/app/actions";
import { continueOnboardingReady } from "@/server/onboarding/actions";
import { ensureOnboardingStep } from "@/lib/onboarding";
import { EvidenceReviewList } from "@/components/onboarding/evidence-review-list";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Notice } from "@/components/ui/feedback";
import { ERRORS, FLASH } from "@/server/http/flash";

export default async function OnboardingReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const state = await ensureOnboardingStep("review");
  const { notice, error } = await searchParams;
  const noticeMessage = notice && notice in FLASH ? FLASH[notice as keyof typeof FLASH] : null;
  const errorMessage = error && error in ERRORS ? ERRORS[error as keyof typeof ERRORS] : null;
  const unverified = state.evidence.filter((item) => item.verification_status === "unverified");

  return (
    <OnboardingShell
      eyebrow="Onboarding"
      title="Review extracted memory"
      body="Extracted items stay unverified until you confirm them. Verified evidence is what generation may cite. Nothing here is auto-approved."
      step="review"
    >
      {noticeMessage ? (
        <div className="mb-6">
          <Notice tone="mint">{noticeMessage}</Notice>
        </div>
      ) : null}
      {errorMessage ? (
        <div className="mb-6">
          <Notice tone="coral">{errorMessage}</Notice>
        </div>
      ) : null}

      <EvidenceReviewList
        evidence={state.evidence}
        empty={
          <EmptyState
            eyebrow="Nothing extracted yet"
            title="Add evidence manually or upload a text resume"
            body="You can verify items later from Application Memory. Continue when you are ready to start applying."
            actions={
              <form action={continueOnboardingReady}>
                <Button type="submit">Continue</Button>
              </form>
            }
          />
        }
        actions={(item) =>
          item.verification_status === "unverified" ? (
            <form action={verifyOnboardingEvidence}>
              <input type="hidden" name="evidenceId" value={item.id} />
              <input type="hidden" name="returnTo" value="/app/onboarding/review" />
              <Button type="submit" variant="secondary">
                Verify this item
              </Button>
            </form>
          ) : null
        }
      />

      <div className="mt-8 flex flex-wrap gap-3">
        {unverified.length > 0 ? (
          <form action={verifyAllExtractedEvidence}>
            <input type="hidden" name="returnTo" value="/app/onboarding/review" />
            <Button type="submit" variant="secondary">
              Verify all extracted items
            </Button>
          </form>
        ) : null}
        <form action={continueOnboardingReady}>
          <Button type="submit">Continue</Button>
        </form>
        <ButtonLink href="/app/memory" variant="ghost">
          Application Memory
        </ButtonLink>
      </div>
    </OnboardingShell>
  );
}
