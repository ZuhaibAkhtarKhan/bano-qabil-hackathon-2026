/**
 * Injected into 1-Apply tabs. Same-origin fetches use the website session cookies
 * so the extension never needs a pasted access token.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
  if (!data || data.source !== "1apply-web" || data.type !== "EXTENSION_DETECT") return;
  window.postMessage(
    {
      source: "1apply-extension",
      type: "EXTENSION_PRESENT",
      extensionId: chrome.runtime.id,
    },
    window.location.origin,
  );
});
