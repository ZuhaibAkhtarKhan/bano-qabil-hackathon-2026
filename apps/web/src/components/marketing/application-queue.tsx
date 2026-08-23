"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import type { QueueItem } from "@/components/marketing/orbital-queue-scene";
import { cn } from "@/lib/cn";

const OrbitalQueueScene = dynamic(
  () => import("@/components/marketing/orbital-queue-scene").then((mod) => mod.OrbitalQueueScene),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[22rem] items-center justify-center text-sm text-ink-muted sm:h-[26rem]">
        Loading applications…
      </div>
    ),
  },
);

const queue: QueueItem[] = [
  {
    id: "ml",
    title: "ML internship",
    detail: "Remote · Fit 87",
    status: "Review required",
    tone: "sand",
    action: "Approve 1 answer",
    deadline: "Tomorrow 23:59",
    orbit: 0,
    phase: 0.2,
  },
  {
    id: "research",
    title: "Research fellowship",
    detail: "Onsite · Fit 74",
    status: "Ready to apply",
    tone: "teal",
    action: "Autofill preview",
    deadline: "12 Sep",
    orbit: 1,
    phase: 1.8,
  },
  {
    id: "stem",
    title: "Scholarship · STEM",
    detail: "Snapshot frozen",
    status: "Submitted",
    tone: "mint",
    action: "Track email",
    deadline: "Stored",
    orbit: 2,
    phase: 3.4,
  },
  {
    id: "hackathon",
    title: "Product hackathon",
    detail: "Deadline soon",
    status: "In progress",
    tone: "violet",
    action: "Generate answers",
    deadline: "Fri 18:00",
    orbit: 0.5,
    phase: 5.0,
  },
];

export function ApplicationQueue() {
  const [activeId, setActiveId] = useState(queue[0]!.id);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const active = queue.find((item) => item.id === activeId) ?? queue[0]!;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (paused || reduceMotion) return;
    const id = setInterval(() => {
      setActiveId((current) => {
        const index = queue.findIndex((item) => item.id === current);
        return queue[(index + 1) % queue.length]!.id;
      });
    }, 3200);
    return () => clearInterval(id);
  }, [paused, reduceMotion]);

  return (
    <div className="relative mx-auto mt-24 max-w-5xl">
      <div className="px-1">
        <h2 className="font-display text-3xl tracking-tight text-ink sm:text-4xl">Application queue</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-ink-muted">
          Opportunities orbit your application memory. Select one to inspect status and next action.
        </p>
      </div>

      <div className="mt-8 grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-12">
        <OrbitalQueueScene
          items={queue}
          activeId={activeId}
          paused={paused}
          reduceMotion={reduceMotion}
          onSelect={(id) => {
            setActiveId(id);
            setPaused(true);
          }}
          onHoverChange={setPaused}
        />

        <div className="px-1">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-ink-muted">Focused</p>
          <h3 className="mt-3 text-2xl font-medium leading-tight tracking-tight text-ink">{active.title}</h3>
          <p className="mt-2 text-sm leading-6 text-ink-muted">{active.detail}</p>

          <dl className="mt-7 space-y-3.5 border-t border-line pt-5">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-ink-muted">Status</dt>
              <dd className="text-sm font-medium text-ink">{active.status}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-ink-muted">Deadline</dt>
              <dd className="text-sm font-medium text-ink">{active.deadline}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-sm text-ink-muted">Next action</dt>
              <dd className="text-sm font-medium text-ink">{active.action}</dd>
            </div>
          </dl>

          <div className="mt-7 flex flex-wrap gap-2">
            {queue.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveId(item.id);
                  setPaused(true);
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition-colors",
                  item.id === activeId
                    ? "border-ink bg-ink text-white"
                    : "border-line bg-transparent text-ink-muted hover:border-ink/25 hover:text-ink",
                )}
              >
                {item.title.split(" · ")[0]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
