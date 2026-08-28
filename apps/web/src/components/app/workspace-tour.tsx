"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { currentGuideStep, type GuideStep } from "@1apply/domain";

import { skipWorkspaceGuide } from "@/server/memory/actions";
import { Button, buttonClassName } from "@/components/ui/button";
import {
  TOUR_WELCOME_KEY,
  currentTourBeat,
  pathMatchesHref,
  pickVisibleTourTarget,
  type TourBeat,
} from "@/lib/workspace-tour";

type Box = { top: number; left: number; width: number; height: number };

type TooltipPlace = {
  left: number;
  top: number;
  side: "right" | "left" | "bottom" | "top";
  cardWidth: number;
};

const HIGHLIGHT_PAD = 8;
const CARD_WIDTH = 320;
const CARD_HEIGHT = 220;
const ARROW_GAP = 36;
const VIEW_MARGIN = 12;

function inflate(rect: DOMRect): Box {
  return {
    top: Math.round(Math.max(8, rect.top - HIGHLIGHT_PAD)),
    left: Math.round(Math.max(8, rect.left - HIGHLIGHT_PAD)),
    width: Math.round(rect.width + HIGHLIGHT_PAD * 2),
    height: Math.round(rect.height + HIGHLIGHT_PAD * 2),
  };
}

function sameBox(a: Box | null, b: Box) {
  if (!a) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

function sameTooltip(a: TooltipPlace, b: TooltipPlace) {
  return a.left === b.left && a.top === b.top && a.side === b.side && a.cardWidth === b.cardWidth;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function placeTooltip(target: Box): TooltipPlace {
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
  const spaceRight = viewW - (target.left + target.width);
  const spaceLeft = target.left;
  const spaceBottom = viewH - (target.top + target.height);

  let side: TooltipPlace["side"] = "right";
  let left = target.left + target.width + ARROW_GAP;
  let top = target.top + target.height / 2 - CARD_HEIGHT / 2;

  if (spaceRight >= CARD_WIDTH + ARROW_GAP) {
    side = "right";
    left = target.left + target.width + ARROW_GAP;
    top = target.top + target.height / 2 - CARD_HEIGHT / 2;
  } else if (spaceLeft >= CARD_WIDTH + ARROW_GAP) {
    side = "left";
    left = target.left - CARD_WIDTH - ARROW_GAP;
    top = target.top + target.height / 2 - CARD_HEIGHT / 2;
  } else if (spaceBottom >= CARD_HEIGHT + ARROW_GAP) {
    side = "bottom";
    left = target.left;
    top = target.top + target.height + ARROW_GAP;
  } else {
    side = "top";
    left = target.left;
    top = target.top - CARD_HEIGHT - ARROW_GAP;
  }

  return {
    side,
    cardWidth: CARD_WIDTH,
    left: clamp(left, VIEW_MARGIN, Math.max(VIEW_MARGIN, viewW - CARD_WIDTH - VIEW_MARGIN)),
    top: clamp(top, VIEW_MARGIN, Math.max(VIEW_MARGIN, viewH - CARD_HEIGHT - VIEW_MARGIN)),
  };
}

function arrowPath(target: Box, tooltip: TooltipPlace) {
  const midY = target.top + target.height / 2;
  const midX = target.left + target.width / 2;
  const tip = { x: 0, y: 0 };
  const head = { x: 0, y: 0 };

  if (tooltip.side === "right") {
    tip.x = tooltip.left;
    tip.y = tooltip.top + 56;
    head.x = target.left + target.width + 2;
    head.y = midY;
  } else if (tooltip.side === "left") {
    tip.x = tooltip.left + tooltip.cardWidth;
    tip.y = tooltip.top + 56;
    head.x = target.left - 2;
    head.y = midY;
  } else if (tooltip.side === "bottom") {
    tip.x = tooltip.left + 48;
    tip.y = tooltip.top;
    head.x = midX;
    head.y = target.top + target.height + 2;
  } else {
    tip.x = tooltip.left + 48;
    tip.y = tooltip.top + CARD_HEIGHT;
    head.x = midX;
    head.y = target.top - 2;
  }

  const dx = head.x - tip.x;
  const dy = head.y - tip.y;
  return `M ${tip.x} ${tip.y} C ${tip.x + dx * 0.35} ${tip.y + dy * 0.05}, ${tip.x + dx * 0.7} ${tip.y + dy * 0.85}, ${head.x} ${head.y}`;
}

function TourActions({
  beat,
  onPage,
  onWelcomeNext,
}: {
  beat: TourBeat;
  onPage: boolean;
  onWelcomeNext: () => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {beat.id === "welcome" ? (
        <Button type="button" size="sm" onClick={onWelcomeNext}>
          {beat.cta}
        </Button>
      ) : onPage ? null : (
        <a href={beat.href} className={buttonClassName("primary", "sm")}>
          {beat.cta}
        </a>
      )}
      <form action={skipWorkspaceGuide}>
        <Button type="submit" variant="ghost" size="sm">
          Skip tutorial
        </Button>
      </form>
    </div>
  );
}

function laterGuideSteps(beat: TourBeat, steps: GuideStep[]) {
  const anchorId = beat.id === "welcome" ? currentGuideStep(steps)?.id : beat.id;
  if (!anchorId) return [];
  return steps.filter((step) => step.id !== anchorId);
}

function TourCard({
  beat,
  steps,
  onPage,
  onWelcomeNext,
  className,
  style,
}: {
  beat: TourBeat;
  steps: GuideStep[];
  onPage: boolean;
  onWelcomeNext: () => void;
  className: string;
  style?: { top: number; left: number };
}) {
  const later = laterGuideSteps(beat, steps);

  return (
    <div role="region" aria-label="Getting started" className={className} style={style}>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sand-text">Look here</p>
      <h2 className="mt-1 font-display text-xl leading-tight">{beat.title}</h2>
      <p className="mt-2 text-sm text-ink-muted">{beat.body}</p>
      <TourActions beat={beat} onPage={onPage} onWelcomeNext={onWelcomeNext} />
      {later.length > 0 ? (
        <ol className="mt-4 grid gap-1.5 text-xs text-ink-muted">
          {later.map((step, index) => (
            <li key={step.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                Then {index + 2}: {step.title}
                {step.optional ? " (optional)" : ""}
              </span>
              <a className="font-medium text-ink hover:underline" href={step.href}>
                {step.cta}
              </a>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export function WorkspaceTour({
  dismissed,
  steps,
}: {
  dismissed: boolean;
  steps: GuideStep[];
}) {
  const pathname = usePathname() ?? "/app";
  const [mounted, setMounted] = useState(false);
  const [seenWelcome, setSeenWelcome] = useState(false);
  const [targetBox, setTargetBox] = useState<Box | null>(null);
  const [tooltip, setTooltip] = useState<TooltipPlace | null>(null);

  useEffect(() => {
    setMounted(true);
    setSeenWelcome(sessionStorage.getItem(TOUR_WELCOME_KEY) === "1");
  }, []);

  const beat = useMemo(
    () => currentTourBeat({ dismissed, steps, pathname, seenWelcome }),
    [dismissed, steps, pathname, seenWelcome],
  );

  useLayoutEffect(() => {
    if (!mounted || !beat) {
      setTargetBox(null);
      setTooltip(null);
      return;
    }

    const measure = () => {
      const node = pickVisibleTourTarget(beat.targets);
      if (!node) {
        setTargetBox(null);
        setTooltip(null);
        return;
      }
      const box = inflate(node.getBoundingClientRect());
      setTargetBox((prev) => (sameBox(prev, box) ? prev : box));
      setTooltip((prev) => {
        const next = placeTooltip(box);
        return prev && sameTooltip(prev, next) ? prev : next;
      });
    };

    const node = pickVisibleTourTarget(beat.targets);
    node?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measure();
    const frame = window.setInterval(measure, 400);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [mounted, beat]);

  if (!mounted || dismissed || !beat) return null;

  const arrow = targetBox && tooltip ? arrowPath(targetBox, tooltip) : null;
  const onPage = pathMatchesHref(pathname, beat.href);
  const markWelcome = () => {
    sessionStorage.setItem(TOUR_WELCOME_KEY, "1");
    setSeenWelcome(true);
  };

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[80]" aria-live="polite">
      {targetBox ? (
        <div
          className="pointer-events-none tour-spotlight absolute rounded-2xl border-2 border-sand"
          style={{
            top: targetBox.top,
            left: targetBox.left,
            width: targetBox.width,
            height: targetBox.height,
          }}
        />
      ) : null}

      {arrow ? (
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <defs>
            <marker id="tour-arrowhead" markerWidth="12" markerHeight="12" refX="10" refY="5" orient="auto">
              <path d="M 0 0 L 12 5 L 0 10 z" className="fill-sand" />
            </marker>
          </defs>
          <path
            d={arrow}
            className="fill-none stroke-sand"
            strokeWidth="2.75"
            strokeLinecap="round"
            markerEnd="url(#tour-arrowhead)"
          />
        </svg>
      ) : null}

      {tooltip ? (
        <TourCard
          beat={beat}
          steps={steps}
          onPage={onPage}
          onWelcomeNext={markWelcome}
          className="pointer-events-auto absolute z-[2] w-[min(20rem,calc(100%-1.5rem))] rounded-2xl border border-line bg-white p-4 shadow-2xl"
          style={{ top: tooltip.top, left: tooltip.left }}
        />
      ) : (
        <TourCard
          beat={beat}
          steps={steps}
          onPage={onPage}
          onWelcomeNext={markWelcome}
          className="pointer-events-auto absolute bottom-4 left-4 z-[2] w-[min(20rem,calc(100%-2rem))] rounded-2xl border border-line bg-white p-4 shadow-2xl"
        />
      )}
    </div>,
    document.body,
  );
}
