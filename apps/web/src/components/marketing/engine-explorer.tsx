"use client";

import { useEffect, useRef, useState } from "react";

import { HowItWorksCubes } from "@/components/marketing/how-it-works-cubes";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const CORNERS = [
  {
    id: "memory",
    corner: "tl" as const,
    label: "Application Memory",
    number: "01",
    color: "#98a5ef",
    body: "Resumes and supporting documents become structured, user-verified facts. Later applications reuse that memory instead of reconstructing it.",
    points: [
      "Identity, education, skills, projects",
      "Evidence with source and verification",
      "Document versions stay immutable",
    ],
  },
  {
    id: "intake",
    corner: "tr" as const,
    label: "Opportunity Intake",
    number: "02",
    color: "#5adeb7",
    body: "Bring a public URL, save a page from the extension, or enter an opportunity by hand. Page content stays untrusted data.",
    points: [
      "URL, extension, and manual entry",
      "Requirements and questions extracted",
      "Fit Index with missing-fact list",
    ],
  },
  {
    id: "agents",
    corner: "bl" as const,
    label: "Grounded Agents",
    number: "03",
    color: "#e69393",
    body: "Drafting retrieves approved evidence only. Every sentence can show why it was written. No evidence means no claim.",
    points: [
      "RAG over your evidence",
      "Cited drafts",
      "Unknowns become review items",
      "Nothing invented to sound stronger",
    ],
  },
  {
    id: "control",
    corner: "br" as const,
    label: "Control & Safety",
    number: "04",
    color: "#eadc8f",
    body: "You approve answers and documents. Autofill never submits. CAPTCHA, MFA, signatures, and payments stay human.",
    points: [
      "Approval workflows at every step",
      "Fill is not submit",
      "Full audit trail for every action",
    ],
  },
] as const;

const LABEL_LINES: Record<(typeof CORNERS)[number]["corner"], Array<"top" | "left" | "bottom" | "right">> = {
  tr: ["top", "left", "bottom"],
  tl: ["top", "left", "bottom", "right"],
  bl: ["top", "left", "bottom", "right"],
  br: ["top", "left", "bottom", "right"],
};

const BASE_SCALES = { tr: 1.08, tl: 0.92, bl: 0.78, br: 0.64 } as const;
const PHASE_SCALES = [
  { tr: 1.18, tl: 1.05, bl: 0.92, br: 0.78 },
  { tr: 1.18, tl: 1.18, bl: 1.05, br: 0.92 },
  { tr: 1.18, tl: 1.18, bl: 1.18, br: 1.05 },
  { tr: 1.18, tl: 1.18, bl: 1.18, br: 1.18 },
] as const;

const ENGINE_BARS = [
  { max: 0.36, power: 1.4 },
  { max: 0.52, power: 1.22 },
  { max: 0.64, power: 1.1 },
  { max: 0.72, power: 1.04 },
] as const;

const BAR_HEIGHT = 120;
const BAR_OVERLAP = 56;
const BAR_STEP = BAR_HEIGHT - BAR_OVERLAP;
const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = BAR_HEIGHT + BAR_STEP * (ENGINE_BARS.length - 1);

const INTRO_WORDS = ["How", "it", "works"] as const;

function barsEvenOddPath(progress: number) {
  return ENGINE_BARS.map((bar, index) => {
    const t = Math.max(0.02, Math.pow(progress, bar.power));
    const w = VIEW_WIDTH * bar.max * t;
    const y = index * BAR_STEP;
    return `M0,${y} H${w} V${y + BAR_HEIGHT} H0 Z`;
  }).join(" ");
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothstep(t: number) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function mapRange(value: number, inMin: number, inMax: number) {
  return smoothstep((value - inMin) / (inMax - inMin));
}

function PlatformBullet({ color }: { color: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill={color} viewBox="0 0 11 10" className="hiw-bullet" aria-hidden="true">
      <path d="M7.333 2.445H3.664v4.889h3.669v2.443H0V0h7.333zm3.664 4.889H7.333V2.445h3.664z" />
    </svg>
  );
}

function cornerScales(cardPhase: number, expandT: number, outroIn: number) {
  if (outroIn > 0.5) {
    return { tr: 1, tl: 1, bl: 1, br: 1, offset: 0 };
  }
  const phaseIndex = Math.min(PHASE_SCALES.length - 1, Math.floor(cardPhase * PHASE_SCALES.length));
  const local = cardPhase * PHASE_SCALES.length - phaseIndex;
  const from = phaseIndex === 0 ? BASE_SCALES : PHASE_SCALES[phaseIndex - 1]!;
  const to = PHASE_SCALES[phaseIndex]!;
  const blended = {
    tr: lerp(from.tr, to.tr, smoothstep(local)),
    tl: lerp(from.tl, to.tl, smoothstep(local)),
    bl: lerp(from.bl, to.bl, smoothstep(local)),
    br: lerp(from.br, to.br, smoothstep(local)),
  };
  return {
    tr: lerp(1, blended.tr, expandT),
    tl: lerp(1, blended.tl, expandT),
    bl: lerp(1, blended.bl, expandT),
    br: lerp(1, blended.br, expandT),
    offset: lerp(0, 0.08, expandT) * (1 - outroIn),
  };
}

export function EngineExplorer() {
  const sectionRef = useRef<HTMLElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const rectangleRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [barProgress, setBarProgress] = useState(0);
  const [rectangleEl, setRectangleEl] = useState<HTMLElement | null>(null);
  const targetRef = useRef(0);
  const smoothRef = useRef(0);
  const barTargetRef = useRef(0);
  const barSmoothRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setRectangleEl(rectangleRef.current);
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    const bars = barsRef.current;
    if (!section) return;

    const measure = () => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const vh = window.innerHeight;

      if (bars) {
        const barRect = bars.getBoundingClientRect();
        if (reduced) {
          barTargetRef.current = barRect.top < vh * 0.85 ? 1 : 0;
        } else {
          const startY = vh * 0.92;
          const endY = vh * 0.38;
          barTargetRef.current = smoothstep((startY - barRect.top) / (startY - endY));
        }
      }

      const rect = section.getBoundingClientRect();
      const scrollable = Math.max(1, section.offsetHeight - vh);
      const raw = (-rect.top) / scrollable;
      targetRef.current = reduced ? clamp01(raw > 0.05 ? 1 : 0) : clamp01(raw);
    };

    const tick = () => {
      smoothRef.current = lerp(smoothRef.current, targetRef.current, 0.085);
      barSmoothRef.current = lerp(barSmoothRef.current, barTargetRef.current, 0.07);
      setProgress(smoothRef.current);
      setBarProgress(barSmoothRef.current);

      if (
        Math.abs(smoothRef.current - targetRef.current) > 0.0008 ||
        Math.abs(barSmoothRef.current - barTargetRef.current) > 0.0008
      ) {
        rafRef.current = window.requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    const schedule = () => {
      measure();
      if (rafRef.current === null) {
        rafRef.current = window.requestAnimationFrame(tick);
      }
    };

    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const frameIn = mapRange(progress, 0.02, 0.14);
  const rotate = lerp(0, 11, mapRange(progress, 0.04, 0.22));
  const scale = lerp(1, 0.934, mapRange(progress, 0.04, 0.22));
  const borderGrow = mapRange(progress, 0.06, 0.2);
  const wordUnderlines = INTRO_WORDS.map((_, i) =>
    mapRange(progress, 0.08 + i * 0.035, 0.14 + i * 0.045),
  );
  const labelsIn = mapRange(progress, 0.16, 0.28);
  const expandT = mapRange(progress, 0.22, 0.34);
  const introFade = mapRange(progress, 0.24, 0.34);
  const introOut = mapRange(progress, 0.78, 0.88);
  const outroIn = mapRange(progress, 0.82, 0.92);
  const cardPhase = clamp01((progress - 0.28) / 0.5);
  const cubeProgress = clamp01((progress - 0.24) / 0.54);
  const activeCard = Math.min(CORNERS.length - 1, Math.floor(cardPhase * CORNERS.length));
  const rings = cornerScales(cardPhase, expandT, outroIn);
  const frameLineOpacity = borderGrow * (1 - expandT);
  const ringLineOpacity = expandT * (1 - outroIn);
  const cubesActive = progress > 0.24 && progress < 0.82;

  return (
    <div className="engine-section" id="how-it-works">
      <div ref={barsRef} className="engine-bars-band" aria-hidden="true">
        <svg className="engine-bars-svg" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="none">
          <path d={barsEvenOddPath(barProgress)} fill="#0e0e0e" fillRule="evenodd" clipRule="evenodd" />
        </svg>
      </div>

      <section
        ref={sectionRef}
        id="safety"
        className="how-it-works"
        aria-label="How 1-Apply works"
      >
        <div className="hiw-sticky">
          <div
            ref={rectangleRef}
            className="hiw-rectangle"
            style={{
              opacity: lerp(0.55, 1, frameIn),
              transform: `rotate(${rotate}deg) scale(${scale})`,
            }}
          >
            <div className="hiw-content" style={{ ["--bg-opacity" as string]: `${outroIn * 72}%` }}>
              <h2
                className="hiw-intro"
                style={{
                  opacity: (1 - introFade) * (1 - introOut),
                  visibility: introOut > 0.98 || introFade > 0.98 ? "hidden" : "visible",
                  transform: `rotate(${-rotate}deg) scale(${lerp(1, 0.85, introFade)})`,
                }}
              >
                <span className="sr-only">How it works</span>
                {INTRO_WORDS.map((word, i) => (
                  <span key={word} className="hiw-word" aria-hidden="true">
                    {word}
                    <span
                      className="hiw-word-underline"
                      style={{ transform: `scaleY(${wordUnderlines[i] ?? 0})` }}
                    />
                    {i < INTRO_WORDS.length - 1 ? "\u00A0" : null}
                  </span>
                ))}
              </h2>

              <div
                className="hiw-outro"
                style={{
                  opacity: outroIn,
                  visibility: outroIn < 0.02 ? "hidden" : "visible",
                  transform: `rotate(${-rotate}deg)`,
                }}
              >
                <h2 className="font-display">The 1-Apply platform</h2>
                <ButtonLink href="/sign-up" variant="inverse" className="hiw-outro-btn">
                  Create your memory
                  <span aria-hidden="true">→</span>
                </ButtonLink>
              </div>
            </div>

            {(["top", "left", "bottom", "right"] as const).map((side) => (
              <div
                key={side}
                className={cn("hiw-frame-line", side)}
                style={{
                  opacity: frameLineOpacity,
                  transform:
                    side === "top" || side === "bottom"
                      ? `scaleX(${borderGrow})`
                      : `scaleY(${borderGrow})`,
                }}
              />
            ))}

            {CORNERS.map((item, index) => {
              const cornerScale = rings[item.corner];
              return (
                <div
                  key={item.id}
                  className={cn("hiw-label-container", item.corner)}
                  style={{
                    opacity: labelsIn * (1 - outroIn * 0.9),
                    zIndex: activeCard === index ? 2 : 1,
                    ["--scale" as string]: String(cornerScale),
                    ["--offset" as string]: String(rings.offset),
                  }}
                >
                  {LABEL_LINES[item.corner].map((side) => (
                    <div
                      key={side}
                      className={cn("hiw-ring-line", side)}
                      style={{
                        opacity: ringLineOpacity,
                        ["--mask" as string]: activeCard === index ? 0 : 0.35,
                        transform:
                          side === "top" || side === "bottom"
                            ? `scaleX(${ringLineOpacity})`
                            : `scaleY(${ringLineOpacity})`,
                      }}
                    />
                  ))}
                  <div
                    className="hiw-label"
                    style={{
                      transform: `rotate(${-rotate}deg)`,
                      opacity: labelsIn * (1 - outroIn * 0.85),
                    }}
                  >
                    <span className="hiw-label-text">{item.label}</span>
                    <span className="hiw-label-square" style={{ backgroundColor: item.color }} />
                  </div>
                </div>
              );
            })}
          </div>

          <HowItWorksCubes
            progress={cubeProgress}
            centerEl={rectangleEl}
            active={cubesActive}
          />
        </div>

        <div className="hiw-info">
          {CORNERS.map((item, index) => {
            const local = clamp01(cardPhase * CORNERS.length - index);
            return (
              <div key={item.id} className="hiw-info-section">
                <article
                  className="hiw-card"
                  style={{
                    transform: `translateY(${(1 - local) * 16}px)`,
                    ["--hiw-accent" as string]: item.color,
                  }}
                >
                  <div className="hiw-card-top">
                    <h3>{item.label}</h3>
                    <div className="hiw-card-index">{item.number}</div>
                  </div>
                  <p>{item.body}</p>
                  <ul>
                    {item.points.map((point) => (
                      <li key={point}>
                        <PlatformBullet color={item.color} />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
