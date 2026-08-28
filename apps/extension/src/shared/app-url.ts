export const APP_BASE_URL_STORAGE_KEY = "appBaseUrl";

/** Default at build time; override in extension Options for deployed demos. */
export const DEFAULT_APP_BASE_URL =
  typeof __EXTENSION_APP_BASE_URL__ !== "undefined" ? __EXTENSION_APP_BASE_URL__ : "http://localhost:3000";

export async function resolveAppBaseUrl(): Promise<string> {
  const stored = await chrome.storage.local.get(APP_BASE_URL_STORAGE_KEY);
  const value = stored[APP_BASE_URL_STORAGE_KEY];
  if (typeof value === "string" && value.trim()) {
    return value.trim().replace(/\/$/, "");
  }
  return DEFAULT_APP_BASE_URL.replace(/\/$/, "");
}

export async function saveAppBaseUrl(url: string): Promise<void> {
  await chrome.storage.local.set({ [APP_BASE_URL_STORAGE_KEY]: url.trim().replace(/\/$/, "") });
}

export function appOriginPattern(base: string): string {
  return `${new URL(base).origin}/*`;
}
