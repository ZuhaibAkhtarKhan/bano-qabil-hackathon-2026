import { APP_BASE_URL, STORAGE_KEYS, appBaseUrl } from "../shared/messages";

export type SessionState = {
  appBaseUrl: string;
};

export async function loadSession(): Promise<SessionState> {
  // Drop any legacy stored URL / JWT from older extension builds.
  await chrome.storage.local.remove(["appBaseUrl", STORAGE_KEYS.deviceToken]);
  return { appBaseUrl: appBaseUrl() };
}

export async function saveSession(_partial?: Partial<SessionState>): Promise<void> {
  await chrome.storage.local.remove(["appBaseUrl", STORAGE_KEYS.deviceToken]);
}

export function appOriginPattern(base = appBaseUrl()): string {
  return `${new URL(base).origin}/*`;
}

export async function ensureAppHostPermission(base = appBaseUrl()): Promise<boolean> {
  const origins = [appOriginPattern(base)];
  const granted = await chrome.permissions.contains({ origins });
  if (granted) return true;
  return chrome.permissions.request({ origins });
}

export async function openAppSignedIn(active = true): Promise<number> {
  const base = appBaseUrl();
  const origin = new URL(base).origin;
  const existing = await chrome.tabs.query({ url: `${origin}/*` });
  const usable = existing.find((tab) => tab.id && tab.url && !tab.url.includes("/sign-in"));
  if (usable?.id) {
    if (active) await chrome.tabs.update(usable.id, { active: true });
    return usable.id;
  }
  const tab = await chrome.tabs.create({ url: `${base}/app`, active });
  if (!tab.id) throw new Error("Could not open 1-Apply.");
  await waitForTabComplete(tab.id);
  return tab.id;
}

function waitForTabComplete(tabId: number, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Timed out waiting for 1-Apply to load."));
    }, timeoutMs);

    function onUpdated(id: number, info: { status?: string }) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }

    void chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
        return;
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  });
}

export { APP_BASE_URL };
