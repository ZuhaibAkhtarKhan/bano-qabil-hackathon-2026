"use client";

import { useState } from "react";

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

export function EngineExplorer() {
  const [activeId, setActiveId] = useState<(typeof nodes)[number]["id"]>("memory");
  const active = nodes.find((node) => node.id === activeId) ?? nodes[0]!;

  return (
    <section id="safety" className="bg-obsidian px-5 py-24 text-white sm:px-8">
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
    </section>
  );
}
