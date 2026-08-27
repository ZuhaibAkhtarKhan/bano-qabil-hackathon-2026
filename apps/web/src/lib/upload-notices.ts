import { FLASH, type FlashCode } from "@/server/http/flash";

const UPLOAD_NOTICES = new Set<FlashCode>([
  "kit_updated",
  "kit_updated_partial",
  "kit_fill_failed",
  "stored_only",
  "document_processing",
  "binary_stored",
  "extracted",
  "duplicate_file",
  "uploaded",
]);

export function isUploadNotice(notice?: string): notice is FlashCode {
  return Boolean(notice && notice in FLASH && UPLOAD_NOTICES.has(notice as FlashCode));
}

export function shouldHideUploadFlashBanner(notice?: string): boolean {
  return isUploadNotice(notice);
}

export function uploadNoticeMessage(notice?: string): string | null {
  if (!isUploadNotice(notice)) return null;
  return FLASH[notice];
}
