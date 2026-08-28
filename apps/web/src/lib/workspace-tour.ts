import { currentGuideStep, type GuideStep } from "@1apply/domain";

export const TOUR_WELCOME_KEY = "1apply-tour-welcome";

export type TourBeat = {
  id: "welcome" | GuideStep["id"];
  title: string;
  body: string;
  href: string;
  cta: string;
  targets: string[];
};

const NAV_TARGET: Record<GuideStep["id"], string> = {
  kit: "nav-kit",
  posting: "nav-posting",
  packet: "nav-needs-you",
  settings: "nav-settings",
};

const PAGE_TARGET: Record<GuideStep["id"], string> = {
  kit: "kit-uploads",
  posting: "posting-url",
  packet: "needs-you-queue",
  settings: "settings-freeze",
};

const STEP_HREF: Record<GuideStep["id"], string> = {
  kit: "/app/memory",
  posting: "/app/opportunities",
  packet: "/app/needs-you",
  settings: "/app/settings",
};

export const WELCOME_BEAT: TourBeat = {
  id: "welcome",
  title: "This is home",
  body: "Dashboard is where packets that need you show up. The box and arrow point at the next click — you can still use the rest of the site.",
  href: "/app",
  cta: "Show me what’s next",
  targets: ["nav-dashboard", "nav-menu", "page-dashboard"],
};

export function pathMatchesHref(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function tourTargetIds(stepId: GuideStep["id"], pathname: string): string[] {
  const href = STEP_HREF[stepId];
  const nav = NAV_TARGET[stepId];
  const page = PAGE_TARGET[stepId];
  const extras = stepId === "kit" ? (["kit-identity"] as const) : [];
  if (pathMatchesHref(pathname, href)) {
    return [page, ...extras, nav, "nav-menu"];
  }
  return [nav, "nav-menu", page, ...extras];
}

export function beatFromStep(step: GuideStep, pathname: string): TourBeat {
  return {
    id: step.id,
    title: step.title,
    body: step.body,
    href: step.href,
    cta: step.cta,
    targets: tourTargetIds(step.id, pathname),
  };
}

export function currentTourBeat(input: {
  dismissed: boolean;
  steps: GuideStep[];
  pathname: string;
  seenWelcome: boolean;
}): TourBeat | null {
  if (input.dismissed) return null;
  const next = currentGuideStep(input.steps);
  if (!input.seenWelcome && pathMatchesHref(input.pathname, "/app")) {
    return WELCOME_BEAT;
  }
  if (!next) return null;
  return beatFromStep(next, input.pathname);
}

export function isElementVisible(node: Element) {
  const rect = node.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = window.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  return true;
}

export function pickVisibleTourTarget(targetIds: string[]): HTMLElement | null {
  if (typeof document === "undefined") return null;
  for (const id of targetIds) {
    const nodes = document.querySelectorAll(`[data-tour="${id}"]`);
    for (const node of nodes) {
      if (node instanceof HTMLElement && isElementVisible(node)) return node;
    }
  }
  return null;
}
