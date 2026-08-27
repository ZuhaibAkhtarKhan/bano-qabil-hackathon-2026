import { FlashBanner } from "@/components/app/flash-banner";
import { UploadNoticeToast } from "@/components/app/upload-notice-toast";
import { shouldHideUploadFlashBanner } from "@/lib/upload-notices";

export function UploadFeedback({ notice, error }: { notice?: string; error?: string }) {
  return (
    <>
      <UploadNoticeToast notice={notice} />
      <FlashBanner notice={shouldHideUploadFlashBanner(notice) ? undefined : notice} error={error} />
    </>
  );
}
