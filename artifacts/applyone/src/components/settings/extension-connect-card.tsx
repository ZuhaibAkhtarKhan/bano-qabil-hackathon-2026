"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type DetectState = "checking" | "present" | "missing";

export function ExtensionConnectCard({ appUrl }: { appUrl: string }) {
  const [state, setState] = useState<DetectState>("checking");

  useEffect(() => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) setState("missing");
    }, 800);

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string } | null;
      if (data?.source === "1apply-extension" && data.type === "EXTENSION_PRESENT") {
        settled = true;
        window.clearTimeout(timer);
        setState("present");
      }
    }

    window.addEventListener("message", onMessage);
    window.postMessage({ source: "1apply-web", type: "EXTENSION_DETECT" }, window.location.origin);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  return (
    <div className="mt-4 space-y-3 text-sm text-ink-muted">
      <p>
        Sign in here, then open the extension Options and click Connect with website session. The extension is wired to{" "}
        <code>{appUrl}</code> for local use — no URL to enter. Allow site access if Chrome asks.
      </p>
      <p>
        {state === "checking"
          ? "Looking for the extension on this tab…"
          : state === "present"
            ? "Extension bridge is active on this tab."
            : "Extension not detected on this tab yet — open Options → Connect (that injects the bridge), then refresh."}
      </p>
      <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
        Recheck
      </Button>
    </div>
  );
}
