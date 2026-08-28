"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { useActionProgress } from "@/components/ui/action-progress";

/** Top loading bar for route transitions and in-flight form/async actions. */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { pendingCount, navigationPending, endNavigation } = useActionProgress();
  const [navActive, setNavActive] = useState(false);

  useEffect(() => {
    endNavigation();
    setNavActive(false);
  }, [pathname, searchParams, endNavigation]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor = (event.target as HTMLElement | null)?.closest("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }
      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;
        if (url.pathname === window.location.pathname && url.search === window.location.search) return;
        setNavActive(true);
      } catch {
        // Ignore malformed hrefs.
      }
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const active = navActive || pendingCount > 0 || navigationPending;
  if (!active) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-1 overflow-hidden bg-ink/10 shadow-sm"
      role="progressbar"
      aria-label="Loading"
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="nav-progress-bar block h-full w-1/3 bg-ink" />
    </div>
  );
}
