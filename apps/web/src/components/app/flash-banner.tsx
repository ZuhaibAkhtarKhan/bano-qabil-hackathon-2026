import { ERRORS, FLASH, type ErrorCode, type FlashCode } from "@/server/http/flash";
import { Notice } from "@/components/ui/feedback";

export function FlashBanner({
  notice,
  error,
}: {
  notice?: string;
  error?: string;
}) {
  const errorMessage = error && error in ERRORS ? ERRORS[error as ErrorCode] : null;
  const noticeMessage = notice && notice in FLASH ? FLASH[notice as FlashCode] : null;
  const message = errorMessage ?? noticeMessage;
  if (!message) return null;
  return (
    <div className="mt-6">
      <Notice tone={errorMessage ? "coral" : "mint"}>{message}</Notice>
    </div>
  );
}
