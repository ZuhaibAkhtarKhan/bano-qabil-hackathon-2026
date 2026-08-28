import type { DetectedField } from "@1apply/form-engine";

export type ExtensionMessage =
  | { type: "PING" }
  | { type: "GET_PAGE_META" }
  | { type: "INVENTORY" }
  | { type: "FILL"; mappings: Array<{ fieldKey: string; value: string; type: string }> }
  | { type: "PAGE_META_RESULT"; url: string; title: string; excerpt: string }
  | { type: "INVENTORY_RESULT"; fields: DetectedField[]; html: string; url: string; title: string }
  | { type: "FILL_RESULT"; filled: Array<{ fieldKey: string; filled: boolean; skippedReason?: string }> };

export { DEFAULT_APP_BASE_URL, resolveAppBaseUrl, saveAppBaseUrl } from "./app-url";

export const STORAGE_KEYS = {
  /** @deprecated Cleared on connect — website cookie session is used instead. */
  deviceToken: "deviceToken",
} as const;
