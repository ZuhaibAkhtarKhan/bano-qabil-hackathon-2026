/**
 * Injected into 1-Apply tabs. Same-origin fetches use the website session cookies
 * so the extension never needs a pasted access token.
 */

function isExtensionContextValid(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isExtensionContextValid()) return false;

  if (message?.type === "BRIDGE_PING") {
    sendResponse({ ok: true, origin: window.location.origin });
    return false;
  }

  if (message?.type !== "BRIDGE_FETCH") return false;

  void (async () => {
    try {
      const path = String(message.path ?? "");
      if (!path.startsWith("/api/")) {
        sendResponse({ error: "Bridge only allows /api/ paths." });
        return;
      }
      const method = String(message.method ?? "GET").toUpperCase();
      const body = typeof message.body === "string" ? message.body : null;
      const response = await fetch(path, {
        method,
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body && method !== "GET" && method !== "HEAD" ? body : undefined,
      });
      const json = await response.json();
      sendResponse({ ok: response.ok, status: response.status, json });
    } catch (error) {
      sendResponse({ error: error instanceof Error ? error.message : "Bridge fetch failed." });
    }
  })();

  return true;
});

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; type?: string } | null;
  if (!data || data.source !== "1apply-web") return;

  if (!isExtensionContextValid()) return;

  if (data.type === "EXTENSION_DETECT") {
    try {
      window.postMessage(
        {
          source: "1apply-extension",
          type: "EXTENSION_PRESENT",
          extensionId: chrome.runtime.id,
        },
        window.location.origin,
      );
    } catch {
      // Extension reloaded — ignore stale bridge.
    }
    return;
  }

  // Need You save → wake the host fill poll immediately instead of waiting for the 1-minute alarm.
  if (data.type === "HOST_SUBMIT_POLL") {
    try {
      void chrome.runtime.sendMessage({ type: "POLL_HOST_SUBMIT_JOBS" }).catch(() => undefined);
    } catch {
      // Extension context invalidated after reload.
    }
  }
});
