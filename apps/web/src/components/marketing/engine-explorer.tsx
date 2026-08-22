"use client";

import { useEffect, useRef, useState } from "react";

const nodes = [
  {
    id: "memory",
    label: "Application Memory",
    number: "01",
    tone: "bg-violet-500",
    position: "left-0 top-0",
    align: "items-start text-left",
    title: "Application Memory",
    body: "Resumes and supporting documents become structured, user-verified facts. Later applications reuse that memory instead of reconstructing it.",
    points: ["Identity, education, skills, projects", "Evidence with source and verification", "Document versions stay immutable"],
  },
  {
    id: "intake",
    label: "Opportunity Intake",
    number: "02",
    tone: "bg-teal-500",
    position: "right-0 top-0",
    align: "items-end text-right",
    title: "Opportunity Intake",
    body: "Bring a public URL, save a page from the extension, or enter an opportunity by hand. Page content is untrusted data and cannot override instructions.",
    points: ["URL, extension, and manual entry", "Requirements and questions extracted", "Fit Index with missing-fact list"],
  },
  {
    id: "agents",
    label: "Grounded Agents",
    number: "03",
    tone: "bg-rose-400",
    position: "left-0 bottom-0",
    align: "items-start text-left",
    title: "Grounded Agents",
    body: "Drafting retrieves approved evidence only. Every sentence can show why it was written. No evidence means no claim.",
    points: ["RAG over your evidence", "Cited drafts", "Unknowns become review items"],
  },
  {
    id: "control",
    label: "Control & Safety",
    number: "04",
    tone: "bg-amber-400",
    position: "right-0 bottom-0",
    align: "items-end text-right",
    title: "Control & Safety",
    body: "You approve answers and documents. Autofill never submits. CAPTCHA, MFA, signatures, payments, and attestations stay human.",
    points: ["Review before fill", "Fill is not submit", "Tenant-isolated storage"],
  },
] as const;

/** Stepped lengths — longest tops out around 70% width. */
const ENGINE_BARS = [
  { max: 0.36, power: 1.4 },
  { max: 0.52, power: 1.22 },
  { max: 0.64, power: 1.1 },
  { max: 0.72, power: 1.04 },
] as const;

/** Deep overlap so the white (even-coverage) bands read clearly. */
const BAR_HEIGHT = 120;
const BAR_OVERLAP = 56;
const BAR_STEP = BAR_HEIGHT - BAR_OVERLAP;
const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = BAR_HEIGHT + BAR_STEP * (ENGINE_BARS.length - 1);

function barsEvenOddPath(progress: number) {
  // One compound path — fill-rule evenodd only punches holes across subpaths of the SAME path
  return ENGINE_BARS.map((bar, index) => {
    const t = Math.max(0.02, Math.pow(progress, bar.power));
    const w = VIEW_WIDTH * bar.max * t;
    const y = index * BAR_STEP;
    return `M0,${y} H${w} V${y + BAR_HEIGHT} H0 Z`;
  }).join(" ");
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothstep(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export function EngineExplorer() {
  const [activeId, setActiveId] = useState<(typeof nodes)[number]["id"]>("memory");
  const active = nodes.find((node) => node.id === activeId) ?? nodes[0]!;
  const barsRef = useRef<HTMLDivElement>(null);
  const [barProgress, setBarProgress] = useState(0);
  const targetRef = useRef(0);
  const smoothRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const node = barsRef.current;
    if (!node) return;

    const measure = () => {
      const rect = node.getBoundingClientRect();
      const vh = window.innerHeight;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (reduced) {
        targetRef.current = rect.top < vh * 0.85 ? 1 : 0;
        return;
      }

      // Grow as the bar band enters mid-viewport
      const startY = vh * 0.92;
      const endY = vh * 0.38;
      const raw = (startY - rect.top) / (startY - endY);
      targetRef.current = smoothstep(raw);
    };

    const tick = () => {
      smoothRef.current = lerp(smoothRef.current, targetRef.current, 0.07);
      setBarProgress(smoothRef.current);

      if (Math.abs(smoothRef.current - targetRef.current) > 0.001) {
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

  return (
    <section id="safety" className="engine-section">
      <div ref={barsRef} className="engine-bars-band" aria-hidden="true">
        <svg
          className="engine-bars-svg"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
        >
          <path
            d={barsEvenOddPath(barProgress)}
            fill="#0e0e0e"
            fillRule="evenodd"
            clipRule="evenodd"
          />
        </svg>
      </div>

      <div className="bg-obsidian px-5 py-24 text-white sm:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
            Engine
          </p>
          <h2 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">The 1-Apply platform</h2>
          <p className="mt-4 max-w-2xl text-zinc-400">
            Four corners of the same system. Memory, intake, generation, and control are connected on purpose.
          </p>

          <div className="mt-14 grid items-center gap-10 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="relative min-h-[420px] rounded-sm border border-white/15 p-8">
              {nodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setActiveId(node.id)}
                  className={`absolute ${node.position} flex ${node.align} gap-2`}
                  aria-pressed={node.id === activeId}
                >
                  <span className={`mt-1 inline-block h-2.5 w-2.5 ${node.tone}`} aria-hidden="true" />
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-300">
                    {node.label}
                  </span>
                </button>
              ))}
              <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center">
                <p className="font-display text-4xl sm:text-5xl">How it works</p>
                <p className="mt-3 max-w-sm text-sm text-zinc-400">
                  Select a corner to inspect that layer. Nothing here is decorative architecture.
                </p>
              </div>
            </div>

            <div>
              <div key={active.id} className="engine-panel">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-display text-3xl">{active.title}</h3>
                  <span className="grid h-8 w-8 place-items-center bg-white/10 font-mono text-xs">
                    {active.number}
                  </span>
                </div>
                <p className="mt-4 text-sm leading-6 text-zinc-400">{active.body}</p>
                <ul className="mt-6 divide-y divide-white/10 border-t border-white/10 text-sm">
                  {active.points.map((point) => (
                    <li key={point} className="py-3">
                      ▸ {point}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
