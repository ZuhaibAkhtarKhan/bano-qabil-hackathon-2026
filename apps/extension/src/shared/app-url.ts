export const APP_BASE_URL_STORAGE_KEY = "appBaseUrl";

export const PRODUCTION_APP_BASE_URL = "http://54.144.220.229";

const LEGACY_LOCAL_DEFAULTS = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);

/** Default at build time; override in extension Options for other deployments. */
export const DEFAULT_APP_BASE_URL =
  typeof __EXTENSION_APP_BASE_URL__ !== "undefined" ? __EXTENSION_APP_BASE_URL__ : PRODUCTION_APP_BASE_URL;

export async function resolveAppBaseUrl(): Promise<string> {
  const stored = await chrome.storage.local.get([APP_BASE_URL_STORAGE_KEY]);
  const value = stored[APP_BASE_URL_STORAGE_KEY];
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().replace(/\/$/, "");
    if (!LEGACY_LOCAL_DEFAULTS.has(normalized)) {
      return normalized;
    }
  }
  return DEFAULT_APP_BASE_URL.replace(/\/$/, "");
}

export async function saveAppBaseUrl(url: string): Promise<void> {
  await chrome.storage.local.set({ [APP_BASE_URL_STORAGE_KEY]: url.trim().replace(/\/$/, "") });
}

export function appOriginPattern(base: string): string {
  return `${new URL(base).origin}/*`;
}
