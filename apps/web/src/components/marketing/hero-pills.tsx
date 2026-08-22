"use client";

import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";

type PillTone = {
  bg: string;
  border: string;
};

type BlurPill = {
  id: string;
  tone: PillTone;
  top: string;
  left?: string;
  right?: string;
  width: string;
  height: string;
  floatDuration: number;
  floatDelay: number;
  parallax: number;
};

type ForegroundPill = {
  id: string;
  label: string;
  tone: PillTone;
  top: string;
  left?: string;
  right?: string;
  translateX?: string;
  floatDuration: number;
  floatDelay: number;
  parallax: number;
  icon: ReactNode;
};

const tones = {
  mist: { bg: "#b5c4f5", border: "#98a5ef" },
  mint: { bg: "#e0eadd", border: "#d1decd" },
  celadon: { bg: "#e0f8f2", border: "#95e6cd" },
  parchment: { bg: "#f9eba6", border: "#eadc8f" },
  brick: { bg: "#f2a9a9", border: "#e69393" },
} as const;

const blurPills: BlurPill[] = [
  { id: "blur-1", tone: tones.mist, top: "26%", left: "15%", width: "6rem", height: "1.25rem", floatDuration: 5.4, floatDelay: 0.2, parallax: 0.09 },
  { id: "blur-2", tone: tones.celadon, top: "14%", right: "22%", width: "7.5rem", height: "1rem", floatDuration: 4.8, floatDelay: 1.1, parallax: 0.07 },
  { id: "blur-3", tone: tones.parchment, top: "48%", left: "28%", width: "5.5rem", height: "1.4rem", floatDuration: 5.8, floatDelay: 0.6, parallax: 0.11 },
  { id: "blur-4", tone: tones.brick, top: "72%", right: "18%", width: "6.5rem", height: "1.15rem", floatDuration: 4.2, floatDelay: 1.4, parallax: 0.08 },
  { id: "blur-5", tone: tones.mint, top: "38%", right: "12%", width: "8rem", height: "1.3rem", floatDuration: 6.2, floatDelay: 0.9, parallax: 0.1 },
  { id: "blur-6", tone: tones.mist, top: "58%", left: "5%", width: "5rem", height: "1rem", floatDuration: 5, floatDelay: 1.8, parallax: 0.12 },
  { id: "blur-7", tone: tones.celadon, top: "72%", left: "4%", width: "6.5rem", height: "1.15rem", floatDuration: 5.6, floatDelay: 0.5, parallax: 0.1 },
];

const foregroundPills: ForegroundPill[] = [
  {
    id: "evidence",
    label: "Evidence only",
    tone: tones.brick,
    top: "10%",
    left: "50%",
    translateX: "-50%",
    floatDuration: 4.2,
    floatDelay: 0,
    parallax: 0.04,
    icon: <IconShield />,
  },
  {
    id: "review",
    label: "Review answers",
    tone: tones.mist,
    top: "22%",
    left: "10%",
    floatDuration: 3.8,
    floatDelay: 0.4,
    parallax: 0.06,
    icon: <IconEdit />,
  },
  {
    id: "fit",
    label: "Fit Index",
    tone: tones.celadon,
    top: "18%",
    right: "8%",
    floatDuration: 4.6,
    floatDelay: 0.8,
    parallax: 0.05,
    icon: <IconChart />,
  },
  {
    id: "match",
    label: "Match resume",
    tone: tones.mint,
    top: "52%",
    left: "7%",
    floatDuration: 5,
    floatDelay: 1.2,
    parallax: 0.07,
    icon: <IconMatch />,
  },
  {
    id: "deadline",
    label: "Track deadline",
    tone: tones.parchment,
    top: "46%",
    right: "6%",
    floatDuration: 4.4,
    floatDelay: 0.6,
    parallax: 0.055,
    icon: <IconCalendar />,
  },
];

const INTRO_DURATION_MS = 1450;
const INTRO_STAGGER_MS = 70;

function slotStyle(
  item: {
    top: string;
    left?: string;
    right?: string;
    translateX?: string;
    tone: PillTone;
    floatDuration: number;
    floatDelay: number;
  },
  extra?: React.CSSProperties,
): React.CSSProperties {
  return {
    top: item.top,
    left: item.left,
    right: item.right,
    ["--pill-bg" as string]: item.tone.bg,
    ["--pill-border" as string]: item.tone.border,
    ["--pill-float-duration" as string]: `${item.floatDuration}s`,
    ["--pill-float-delay" as string]: `${item.floatDelay}s`,
    ["--pill-base-x" as string]: item.translateX ?? "0px",
    ...extra,
  };
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

/** Gentle S-curve — slow start and end for scroll-linked motion. */
function easeScroll(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(current: number, target: number, amount: number) {
  return current + (target - current) * amount;
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

type SlotMetrics = {
  offsetX: number;
  offsetY: number;
  restX: number;
  restY: number;
  baseX: string;
  index: number;
};

export function HeroPills({
  sectionRef,
  queueRef,
}: {
  sectionRef: RefObject<HTMLElement | null>;
  queueRef: RefObject<HTMLElement | null>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const slotMetricsRef = useRef<Map<HTMLElement, SlotMetrics>>(new Map());
  const mouseRef = useRef({ x: 0, y: 0 });
  const smoothProgressRef = useRef(0);
  const targetProgressRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);
  const introStartRef = useRef<number | null>(null);
  const introDoneRef = useRef(false);

  const measureSlots = useCallback(() => {
    const section = sectionRef.current;
    const queue = queueRef.current;
    const root = rootRef.current;
    if (!section || !root) return;

    const sectionRect = section.getBoundingClientRect();
    const targetX = sectionRect.width / 2;
    const targetY = sectionRect.height * 0.5;

    // Origin: top-center of the dashboard peek (pills emerge from behind it)
    let originX = targetX;
    let originY = sectionRect.height * 0.92;
    if (queue) {
      const queueRect = queue.getBoundingClientRect();
      originX = queueRect.left - sectionRect.left + queueRect.width / 2;
      originY = queueRect.top - sectionRect.top + Math.min(72, queueRect.height * 0.12);
    }

    const map = new Map<HTMLElement, SlotMetrics>();

    root.querySelectorAll<HTMLElement>(".hero-pill-slot").forEach((slot, index) => {
      const motion = slot.querySelector<HTMLElement>(".hero-pill-motion");
      if (!motion) return;

      motion.style.transform = "none";
      motion.style.opacity = "1";

      const slotRect = slot.getBoundingClientRect();
      const cx = slotRect.left - sectionRect.left + slotRect.width / 2;
      const cy = slotRect.top - sectionRect.top + slotRect.height / 2;
      const baseX = getComputedStyle(slot).getPropertyValue("--pill-base-x").trim() || "0px";

      map.set(slot, {
        offsetX: cx - targetX,
        offsetY: cy - targetY,
        restX: cx - originX,
        restY: cy - originY,
        baseX,
        index,
      });
    });

    slotMetricsRef.current = map;
  }, [queueRef, sectionRef]);

  const applyMotion = useCallback(() => {
    const root = rootRef.current;
    const section = sectionRef.current;
    const queue = queueRef.current;
    if (!root || !section || !queue) return;

    const sectionRect = section.getBoundingClientRect();
    const queueRect = queue.getBoundingClientRect();

    const peekHeight = 56;
    const scrollEnd = Math.max(
      sectionRect.height * 1.05 + queueRect.height * 0.45,
      (queue.offsetTop - peekHeight) * 1.65,
      sectionRect.height,
      1,
    );
    const rawProgress = Math.min(1, Math.max(0, window.scrollY / scrollEnd));
    targetProgressRef.current = easeScroll(rawProgress);
    smoothProgressRef.current = lerp(smoothProgressRef.current, targetProgressRef.current, 0.085);
    const progress = smoothProgressRef.current;

    const moveProgress = easeInOutCubic(Math.min(1, progress / 0.92));
    const fadeProgress = easeInOutCubic(Math.max(0, (progress - 0.12) / 0.88));

    const { x: mx, y: my } = mouseRef.current;
    const mouseStrength = 1 - moveProgress;

    if (reducedMotionRef.current) {
      root.querySelectorAll<HTMLElement>(".hero-pill-motion").forEach((el) => {
        el.style.transform = "";
        el.style.opacity = "1";
      });
      root.classList.add("hero-pills--ready");
      return;
    }

    const now = performance.now();
    if (
      introStartRef.current !== null &&
      !introDoneRef.current &&
      now - introStartRef.current > INTRO_DURATION_MS + INTRO_STAGGER_MS * slotMetricsRef.current.size
    ) {
      introDoneRef.current = true;
    }

    const tuckY = queueRect.top - sectionRect.top + peekHeight * 0.5;

    slotMetricsRef.current.forEach((metrics, slot) => {
      const motion = slot.querySelector<HTMLElement>(".hero-pill-motion");
      if (!motion) return;

      const { offsetX, offsetY, restX, restY, baseX, index } = metrics;

      const introT = introDoneRef.current
        ? 1
        : introStartRef.current === null
          ? 0
          : easeOutCubic(
              clamp01((now - introStartRef.current - index * INTRO_STAGGER_MS) / INTRO_DURATION_MS),
            );

      // From dashboard origin → rest
      const emergeX = -restX * (1 - introT);
      const emergeY = -restY * (1 - introT);
      const emergeScale = 0.72 + introT * 0.28;
      const emergeOpacity = 0.15 + introT * 0.85;

      // Scroll tuck
      const convergeX = -offsetX * moveProgress;
      const convergeY = -offsetY * moveProgress + moveProgress * (tuckY - sectionRect.height * 0.5);
      const scrollScale = 1 - fadeProgress * 0.18;
      const scrollOpacity = Math.max(0, 1 - fadeProgress * 0.92);

      const parallax = parseFloat(slot.style.getPropertyValue("--pill-parallax") || "0.05");
      const mouseX = mx * parallax * 90 * mouseStrength * introT;
      const mouseY = my * parallax * 60 * mouseStrength * introT;

      const baseTranslate = baseX !== "0px" ? `translateX(${baseX}) ` : "";
      const x = emergeX + convergeX + mouseX;
      const y = emergeY + convergeY + mouseY;
      const scale = emergeScale * scrollScale;
      const opacity = emergeOpacity * scrollOpacity;

      motion.style.transform = `${baseTranslate}translate3d(${x}px, ${y}px, 0) scale(${scale})`;
      motion.style.opacity = String(opacity);
      slot.style.animationPlayState = introT < 0.95 || moveProgress > 0.06 ? "paused" : "running";
    });

    root.classList.add("hero-pills--ready");
    root.style.opacity = String(Math.max(0, 1 - fadeProgress * 0.95));
  }, [queueRef, sectionRef]);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const loop = () => {
      applyMotion();
      const introActive =
        !reducedMotionRef.current &&
        introStartRef.current !== null &&
        !introDoneRef.current;
      if (
        introActive ||
        Math.abs(smoothProgressRef.current - targetProgressRef.current) > 0.001
      ) {
        rafRef.current = window.requestAnimationFrame(loop);
      } else {
        rafRef.current = null;
      }
    };

    const schedule = () => {
      if (rafRef.current === null) {
        rafRef.current = window.requestAnimationFrame(loop);
      }
    };

    const onScroll = () => schedule();

    const onPointerMove = (event: PointerEvent) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      mouseRef.current = {
        x: (event.clientX / w - 0.5) * 2,
        y: (event.clientY / h - 0.5) * 2,
      };
      schedule();
    };

    const onResize = () => {
      measureSlots();
      schedule();
    };

    measureSlots();

    if (reducedMotionRef.current || window.scrollY > 24) {
      introDoneRef.current = true;
      introStartRef.current = performance.now() - INTRO_DURATION_MS * 2;
      schedule();
    } else {
      introDoneRef.current = false;
      introStartRef.current = null;
      requestAnimationFrame(() => {
        measureSlots();
        introStartRef.current = performance.now();
        schedule();
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [applyMotion, measureSlots]);

  return (
    <div ref={rootRef} className="hero-pills" aria-hidden="true">
      <div className="hero-pills-layer hero-pills-bg">
        {blurPills.map((pill) => (
          <div
            key={pill.id}
            className="hero-pill-slot"
            style={slotStyle(pill, { ["--pill-parallax" as string]: String(pill.parallax) })}
          >
            <div className="hero-pill-motion">
              <div
                className="hero-pill-blur"
                data-blur-id={pill.id}
                style={{ width: pill.width, height: pill.height }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="hero-pills-layer hero-pills-fg">
        {foregroundPills.map((pill) => (
          <div
            key={pill.id}
            className="hero-pill-slot"
            style={slotStyle(pill, { ["--pill-parallax" as string]: String(pill.parallax) })}
          >
            <div className="hero-pill-motion">
              <div className="hero-pill-fg" data-pill-id={pill.id}>
                <div className="hero-pill-icon">{pill.icon}</div>
                <div className="hero-pill-text">{pill.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IconShield() {
  return (
    <svg fill="currentColor" viewBox="0 0 17 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4.39551 9.85254C5.08678 11.0396 6.13924 11.9895 7.40332 12.5518L2.85352 17.1025L0 14.249L4.39551 9.85254ZM10.0654 0C13.6869 0.000192622 16.6228 2.93604 16.623 6.55762C16.623 10.1794 13.687 13.116 10.0654 13.1162C9.11758 13.1162 8.2169 12.9136 7.40332 12.5518L10.0498 9.90625L7.19629 7.05273L4.39551 9.85254C3.83165 8.88425 3.50684 7.75888 3.50684 6.55762C3.50704 2.93592 6.44377 0 10.0654 0Z" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg fill="currentColor" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M11.0234 17.6143H12.8135V17.6182H4.5957V17.6084H6.65918V5.87891H11.0234V17.6143ZM17.4717 17.6143H12.8135V5.87891H11.0234V3.52734H17.4717V17.6143ZM6.65918 5.87891H4.5957V17.6084H0V0H6.65918V5.87891Z" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg fill="currentColor" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M0 6.12402V1.75195L2.62402 1.75195V3.49805L11.3701 3.49805V1.75195L13.9932 1.75195V6.12402L0 6.12402ZM11.3701 12.2461V10.4893L2.62402 10.4893V12.2461L0 12.2461V7.87402L13.9932 7.87402V12.2461L11.3701 12.2461ZM2.62402 1.75195V-4.96961e-07L11.3701 -1.14657e-07V1.75195L2.62402 1.75195ZM2.62402 13.9873V12.2461L11.3701 12.2461V13.9873L2.62402 13.9873Z" />
    </svg>
  );
}

function IconMatch() {
  return (
    <svg fill="currentColor" viewBox="0 0 13 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M10.5352 11.4814C11.3351 12.4172 11.8193 13.6314 11.8193 14.959C11.8193 17.9166 9.42149 20.3142 6.46387 20.3145C3.50605 20.3145 1.10749 17.9168 1.10742 14.959C1.10742 13.6316 1.59095 12.4172 2.39062 11.4814C3.50235 12.385 4.91962 12.9267 6.46387 12.9268C8.00755 12.9268 9.4236 12.3844 10.5352 11.4814ZM6.46387 0C10.0337 0 12.9277 2.89404 12.9277 6.46387C12.9276 8.48984 11.994 10.2964 10.5352 11.4814C9.55294 10.3325 8.09393 9.60364 6.46387 9.60352C4.83337 9.60352 3.37293 10.332 2.39062 11.4814C0.932523 10.2964 0.000130748 8.48923 0 6.46387C0 2.89408 2.89409 6.35031e-05 6.46387 0Z" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg fill="currentColor" viewBox="0 0 22 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M-7.30544e-07 2.11524L-5.17707e-07 6.98438L2.47168 6.98438L2.47168 4.62207L19.0312 4.62207L19.0312 6.98438L21.5039 6.98438L21.5039 2.11523L-7.30544e-07 2.11524ZM2.47168 6.98438L2.47168 11.7344L4.94629 11.7344L4.94629 9.44141L16.5566 9.44141L16.5566 11.7344L19.0312 11.7344L19.0312 6.98438L2.47168 6.98438ZM4.94629 11.7344L4.94629 16.4141L7.09473 16.4141L7.09473 14.0654L14.4102 14.0654L14.4102 16.4141L16.5566 16.4141L16.5566 11.7344L4.94629 11.7344ZM7.09473 16.4141L7.09473 18.8281L14.4102 18.8281L14.4102 16.4141L7.09473 16.4141Z" />
    </svg>
  );
}
