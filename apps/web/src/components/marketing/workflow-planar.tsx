"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { cn } from "@/lib/cn";

type PhaseTone = "setup" | "analyze" | "apply";
type ScenePhase = "stacking" | "packing" | "sealed";

type WorkflowStep = {
  id: string;
  title: string;
  body: string;
  phase: PhaseTone;
  layerLabel: string;
};

const STEPS: WorkflowStep[] = [
  { id: "profile", title: "Create your profile", body: "Your evidence starts here", phase: "setup", layerLabel: "Identity" },
  { id: "upload", title: "Upload resumes & docs", body: "Extracted automatically", phase: "setup", layerLabel: "Documents" },
  { id: "verify", title: "Verify extracted info", body: "Becomes your evidence", phase: "setup", layerLabel: "Memory" },
  { id: "save", title: "Save an opportunity", body: "Link, extension, or manual", phase: "analyze", layerLabel: "Opportunity" },
  { id: "requirements", title: "AI reads requirements", body: "Deadline, eligibility, docs", phase: "analyze", layerLabel: "Requirements" },
  { id: "fit", title: "Fit Index & resume match", body: "Score plus best resume", phase: "analyze", layerLabel: "Fit" },
  { id: "generate", title: "Generate grounded answers", body: "Sourced from your evidence", phase: "apply", layerLabel: "Answers" },
  { id: "review", title: "Review & approve", body: "You approve everything", phase: "apply", layerLabel: "Approval" },
  { id: "autofill", title: "Autofill & submit", body: "You control sensitive fields", phase: "apply", layerLabel: "Autofill" },
  { id: "track", title: "Track & remember", body: "Status, documents, follow-ups", phase: "apply", layerLabel: "History" },
];

const PHASE_META: Record<PhaseTone, { label: string; surface: string; border: string; chip: string; accent: string }> = {
  setup: {
    label: "1. Build memory",
    surface: "bg-zinc-800",
    border: "border-sky-400/50",
    chip: "border-sky-400/40 bg-sky-400/10 text-sky-100",
    accent: "bg-sky-400",
  },
  analyze: {
    label: "2. Measure fit",
    surface: "bg-zinc-800",
    border: "border-white/25",
    chip: "border-white/25 bg-white/10 text-zinc-100",
    accent: "bg-white",
  },
  apply: {
    label: "3. Apply with control",
    surface: "bg-zinc-800",
    border: "border-amber-400/45",
    chip: "border-amber-400/40 bg-amber-400/10 text-amber-100",
    accent: "bg-amber-400",
  },
};

const STEP_MS = 500;
const PACK_MS = 900;
const SEAL_HOLD_MS = 3400;
const RESET_PAUSE_MS = 850;

export function WorkflowPlanar() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const trailRef = useRef<Array<{ x: number; y: number }>>([]);
  const [trailPath, setTrailPath] = useState("");
  const [cursorDot, setCursorDot] = useState({ x: 50, y: 50 });
  const [inView, setInView] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [builtCount, setBuiltCount] = useState(0);
  const [scene, setScene] = useState<ScenePhase>("stacking");
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setInView(true);
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || reduceMotion) return;
    let frame = 0;
    let idle = 0;
    const tick = () => {
      const points = trailRef.current;
      idle += 1;
      if (idle > 8 && points.length > 2) {
        points.shift();
      }
      if (points.length > 1) {
        if (points.length > 22) points.splice(0, points.length - 22);
        const d = points
          .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
          .join(" ");
        setTrailPath(d);
        const last = points[points.length - 1]!;
        setCursorDot({ x: last.x, y: last.y });
      } else if (points.length === 1) {
        setTrailPath("");
        setCursorDot({ x: points[0]!.x, y: points[0]!.y });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const markMove = () => {
      idle = 0;
    };
    const node = stageRef.current;
    node?.addEventListener("pointermove", markMove);
    return () => {
      cancelAnimationFrame(frame);
      node?.removeEventListener("pointermove", markMove);
    };
  }, [inView, reduceMotion]);

  useEffect(() => {
    if (!inView) return;
    if (reduceMotion) {
      setBuiltCount(STEPS.length);
      setActiveIndex(STEPS.length - 1);
      setScene("sealed");
      return;
    }

    let cancelled = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const later = (fn: () => void, ms: number) => {
      timers.push(setTimeout(fn, ms));
    };

    const startCycle = () => {
      if (cancelled) return;
      setScene("stacking");
      setBuiltCount(0);
      setActiveIndex(0);

      const drop = (index: number) => {
        if (cancelled) return;
        setActiveIndex(index);
        setBuiltCount(index + 1);
        if (index + 1 >= STEPS.length) {
          later(() => {
            if (cancelled) return;
            setScene("packing");
            later(() => {
              if (cancelled) return;
              setScene("sealed");
              later(() => {
                if (cancelled) return;
                later(startCycle, RESET_PAUSE_MS);
              }, SEAL_HOLD_MS);
            }, PACK_MS);
          }, 450);
          return;
        }
        later(() => drop(index + 1), STEP_MS);
      };

      later(() => drop(0), 180);
    };

    startCycle();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [inView, reduceMotion]);

  const onStageMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || reduceMotion) return;
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const points = trailRef.current;
    const last = points[points.length - 1];
    if (!last || Math.hypot(last.x - x, last.y - y) > 1.2) {
      points.push({ x, y });
      if (points.length > 28) points.shift();
    }
  };

  const active = STEPS[Math.min(activeIndex, STEPS.length - 1)]!;
  const complete = scene !== "stacking" || builtCount === STEPS.length;

  return (
    <section
      ref={sectionRef}
      id="how-it-works"
      className="relative overflow-hidden bg-obsidian px-5 py-24 text-white sm:px-8"
      aria-labelledby="workflow-heading"
    >
      <div className="relative mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-zinc-400">How 1-Apply works</p>
          <h2 id="workflow-heading" className="mt-3 font-display text-4xl leading-tight sm:text-5xl">
            Ten steps. One sealed application pack.
          </h2>
          <p className="mt-4 text-base leading-7 text-zinc-300">
            Build verified memory, score the opportunity, generate answers from evidence, then pack everything
            into one place you can autofill and track.
          </p>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.2fr)] lg:items-start">
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PHASE_META) as PhaseTone[]).map((phase) => (
                <span
                  key={phase}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs",
                    PHASE_META[phase].chip,
                    active.phase === phase && scene === "stacking" ? "opacity-100" : "opacity-45",
                    scene !== "stacking" && "opacity-75",
                  )}
                >
                  {PHASE_META[phase].label}
                </span>
              ))}
            </div>

            <ol className="grid gap-2" aria-label="Application workflow">
              {STEPS.map((step, index) => {
                const done = index < builtCount || scene !== "stacking";
                const current = scene === "stacking" && index === activeIndex;
                return (
                  <li
                    key={step.id}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-300",
                      current
                        ? "workflow-step-pulse border-white/40 bg-white/10"
                        : done
                          ? "border-white/20 bg-white/[0.06]"
                          : "border-white/10 bg-transparent opacity-35",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-medium",
                        current ? "bg-white text-ink" : done ? "bg-white text-ink" : "bg-white/10 text-zinc-400",
                      )}
                    >
                      {done && !current ? "✓" : String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{step.title}</p>
                      <p className="truncate text-xs text-zinc-400">{step.body}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <div
            className={cn(
              "relative overflow-hidden rounded-[1.75rem] border bg-zinc-950 p-6 transition-colors duration-500 sm:p-8",
              scene === "sealed" ? "border-white/35" : "border-white/15",
            )}
          >
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-zinc-400">
                  {scene === "stacking" ? "Building pack" : scene === "packing" ? "Sealing pack" : "Ready to apply"}
                </p>
                <p className="mt-1 text-sm text-zinc-200">
                  {scene === "stacking"
                    ? `${builtCount} / ${STEPS.length} layers in`
                    : scene === "packing"
                      ? "Collapsing layers into one pack"
                      : "All steps packed"}
                </p>
              </div>
              <span className="rounded-full border border-white/20 px-3 py-1 text-xs text-zinc-300">
                {complete ? "Complete" : active.layerLabel}
              </span>
            </div>

            <div
              ref={stageRef}
              className="workflow-stage relative mx-auto flex min-h-[28rem] items-center justify-center sm:min-h-[32rem]"
              onPointerMove={onStageMove}
            >
              <div className="workflow-cursor-field pointer-events-none absolute inset-0" aria-hidden="true">
                <svg className="workflow-cursor-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <path className="workflow-cursor-trail-soft" d={trailPath} />
                  <path className="workflow-cursor-trail" d={trailPath} />
                </svg>
                <span
                  className="workflow-cursor-orb"
                  style={{ left: `${cursorDot.x}%`, top: `${cursorDot.y}%` }}
                />
              </div>

              <div
                className={cn(
                  "workflow-scene",
                  scene === "packing" && "workflow-scene-pack",
                  scene === "sealed" && "workflow-scene-sealed",
                )}
                aria-hidden="true"
              >
                <div className={cn("workflow-stack", scene !== "stacking" && "workflow-stack-pack")}>
                  {STEPS.map((step, index) => {
                    const visible = index < builtCount;
                    const meta = PHASE_META[step.phase];
                    return (
                      <div
                        key={step.id}
                        className={cn(
                          "workflow-layer",
                          meta.surface,
                          meta.border,
                          visible ? "workflow-layer-visible" : "workflow-layer-hidden",
                          index === builtCount - 1 && scene === "stacking" && "workflow-layer-latest",
                        )}
                        style={{
                          ["--layer-index" as string]: index,
                          zIndex: index + 1,
                          animationDelay: visible ? `${index * 20}ms` : undefined,
                        }}
                      >
                        <div className="flex h-full items-center justify-between gap-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <span className={cn("h-2 w-2 rounded-full", meta.accent)} />
                            <span className="text-sm font-medium text-white">{step.layerLabel}</span>
                          </div>
                          <span className="text-xs text-zinc-400">{String(index + 1).padStart(2, "0")}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div
                  className={cn(
                    "workflow-envelope",
                    scene === "packing" && "workflow-envelope-enter",
                    scene === "sealed" && "workflow-envelope-sealed",
                  )}
                >
                  <div className="workflow-envelope-flap" />
                  <div className="workflow-envelope-body">
                    <div className="workflow-envelope-seal">1-Apply</div>
                    <p className="mt-3 text-center text-sm font-medium text-zinc-200">Application pack</p>
                    <p className="mt-1 text-center text-xs text-zinc-400">
                      Memory · Fit · Answers · Docs · Tracking
                    </p>
                  </div>
                </div>
              </div>

              <div
                className={cn(
                  "workflow-punchline absolute inset-x-4 bottom-3 sm:inset-x-8",
                  scene === "sealed" ? "workflow-punchline-show" : "workflow-punchline-hide",
                )}
              >
                <p className="rounded-2xl border border-white/20 bg-zinc-900 px-4 py-4 text-center text-sm leading-6 text-zinc-200 sm:text-base">
                  Not juggling through multiple documents.
                  <span className="mt-1 block font-medium text-white">Just apply with 1-Apply.</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}
