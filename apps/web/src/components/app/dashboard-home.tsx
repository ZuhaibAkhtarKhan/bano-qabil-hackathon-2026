"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, HelpCircle, Search } from "lucide-react";

import {
  ApplicationsTrackerTable,
  type ApplicationsTrackerRow,
} from "@/components/app/applications-tracker-table";
import { useRealtime } from "@/components/app/realtime-provider";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { cn } from "@/lib/cn";

export type DashboardMatch = {
  id: string;
  href: string;
  company: string;
  role: string;
  match: number | null;
  tone: "sand" | "mint" | "violet" | "coral";
  sourceLabel: string | null;
  /** Application lifecycle status for CTA (e.g. submitted → tag, not Apply). */
  status: string;
  statusLabel: string;
};

export type DashboardApplicationRow = ApplicationsTrackerRow & {
  filter: "all" | "in_flight" | "needs_you" | "failed" | "skipped";
};

export type DashboardKitProps = {
  ready: boolean;
  missing: string[];
  showCard: boolean;
};

export type DashboardLaneProps = {
  needsYou: number;
  sendsAtDeadline: number;
  waitingHost: number;
  prepareAndSendIfSilent: boolean;
  needsYouPreview: Array<{
    id: string;
    title: string;
    host: string;
    deadlineLabel: string;
    summary: string;
    href: string;
  }>;
};

const CARD_TONES = {
  sand: "border-amber-200/80 bg-[#faf6e8]",
  mint: "border-emerald-200/80 bg-[#eef8f1]",
  violet: "border-violet-200/80 bg-[#f3f0fb]",
  coral: "border-rose-200/80 bg-[#fbf0f0]",
} as const;

const FILTERS = [
  { id: "all" as const, label: "All" },
  { id: "in_flight" as const, label: "In flight" },
  { id: "needs_you" as const, label: "Needs you" },
  { id: "failed" as const, label: "Failed" },
  { id: "skipped" as const, label: "Skipped" },
];

export function DashboardHome({
  matches,
  applications,
  displayName = null,
  kit,
  lanes,
}: {
  matches: DashboardMatch[];
  applications: DashboardApplicationRow[];
  displayName?: string | null;
  kit?: DashboardKitProps;
  lanes?: DashboardLaneProps;
}) {
  const { unreadCount } = useRealtime();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const matchesRef = useRef<HTMLElement>(null);
  const [revealProgress, setRevealProgress] = useState(0);
  const targetProgressRef = useRef(0);
  const smoothProgressRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const node = matchesRef.current;
    if (!node || matches.length === 0) return;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const measureTarget = () => {
      const rect = node.getBoundingClientRect();
      const vh = window.innerHeight;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (reduced) {
        targetProgressRef.current = rect.top < vh * 0.92 ? 1 : 0;
        return;
      }

      const startY = vh * 0.95;
      const endY = vh * 0.42;
      const raw = (startY - rect.top) / (startY - endY);
      const clamped = Math.min(1, Math.max(0, raw));
      targetProgressRef.current = clamped * clamped * (3 - 2 * clamped);
    };

    let running = true;
    const tick = () => {
      if (!running) return;
      measureTarget();
      smoothProgressRef.current = lerp(smoothProgressRef.current, targetProgressRef.current, 0.068);
      setRevealProgress(smoothProgressRef.current);
      rafRef.current = window.requestAnimationFrame(tick);
    };

    smoothProgressRef.current = 0;
    targetProgressRef.current = 0;
    setRevealProgress(0);
    measureTarget();
    rafRef.current = window.requestAnimationFrame(tick);

    return () => {
      running = false;
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [matches]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return applications.filter((row) => {
      if (filter === "needs_you") {
        if (!(row.needsYouCount > 0 || row.filter === "needs_you")) return false;
      } else if (filter !== "all" && row.filter !== filter) {
        return false;
      }
      if (!q) return true;
      return `${row.company} ${row.role} ${row.statusLabel} ${row.sourceLabel ?? ""}`.toLowerCase().includes(q);
    });
  }, [applications, filter, query]);

  return (
    <div className="min-h-full bg-white" data-tour="page-dashboard">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-6 lg:px-8">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-ink">Dashboard</h1>
          {displayName ? (
            <p className="truncate text-xs text-ink-muted">Welcome back, {displayName}</p>
          ) : null}
        </div>
        <label className="mx-auto hidden max-w-md flex-1 sm:block">
          <span className="sr-only">Search applications</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title, company…"
              className="w-full rounded-full border border-line bg-[#fafbf8] py-2 pl-10 pr-4 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-ink/30 focus:bg-white"
            />
          </span>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <ButtonLink href="/app/opportunities" size="sm">
            Add a posting
          </ButtonLink>
          <Link
            href="/app/notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-ink-muted hover:text-ink"
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            {unreadCount > 0 ? (
              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden="true" />
            ) : null}
          </Link>
          <Link
            href="/app/settings"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-ink-muted hover:text-ink"
            aria-label="Help and settings"
          >
            <HelpCircle className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <div className="space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        {kit?.showCard ? (
          <section className="rounded-2xl border border-amber-200/80 bg-[#faf6e8] p-5" aria-labelledby="kit-heading">
            <p className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">Your kit</p>
            <h2 id="kit-heading" className="mt-1 text-base font-semibold tracking-tight text-ink">
              Upload once, reuse everywhere
            </h2>
            <p className="mt-1.5 text-sm text-ink-muted">
              Name, university, resume, CNIC, and B-form live in one place. Missing:{" "}
              {kit.missing.join(", ") || "nothing"}.
            </p>
            <div className="mt-4">
              <ButtonLink href="/app/memory" size="sm">
                Open your kit
              </ButtonLink>
            </div>
          </section>
        ) : null}

        {lanes ? (
          <section aria-labelledby="packet-lanes-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="packet-lanes-heading" className="text-base font-semibold tracking-tight text-ink">
                Packets needing attention
              </h2>
              <Link href="/app/needs-you" className="text-sm font-medium text-ink-muted hover:text-ink">
                Open Need You →
              </Link>
            </div>
            <dl className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-line bg-white p-4">
                <dt className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">Needs you</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-ink">{lanes.needsYou}</dd>
                <p className="mt-1 text-xs text-ink-muted">Missing facts, docs, or answers</p>
              </div>
              <div className="rounded-2xl border border-line bg-white p-4">
                <dt className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">Sends at deadline</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-ink">{lanes.sendsAtDeadline}</dd>
                <p className="mt-1 text-xs text-ink-muted">
                  {lanes.prepareAndSendIfSilent
                    ? "Silence will auto-submit"
                    : "Turn on in Settings to auto-submit"}
                </p>
              </div>
              <div className="rounded-2xl border border-line bg-white p-4">
                <dt className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">Waiting on host</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-ink">{lanes.waitingHost}</dd>
                <p className="mt-1 text-xs text-ink-muted">CAPTCHA, signature, or payment</p>
              </div>
            </dl>
            {lanes.needsYouPreview.length > 0 ? (
              <ul className="mt-3 grid gap-2">
                {lanes.needsYouPreview.map((packet) => (
                  <li key={packet.id}>
                    <Link
                      href={packet.href}
                      className="block rounded-2xl border border-line bg-white px-4 py-3 hover:bg-[#fafbf8]/60"
                    >
                      <p className="text-sm font-medium text-ink">{packet.title}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {packet.host} · {packet.deadlineLabel}
                      </p>
                      <p className="mt-1 text-xs text-ink-muted">{packet.summary}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        <section ref={matchesRef} aria-labelledby="top-matches-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="top-matches-heading" className="text-base font-semibold tracking-tight text-ink">
              Top job matches
            </h2>
            <Link href="/app/opportunities" className="text-sm font-medium text-ink-muted hover:text-ink">
              Add a posting →
            </Link>
          </div>

          {matches.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                eyebrow="Matches"
                title="No opportunities yet"
                body="Save a page from the extension or add a posting here — matches and applications show up in one pipeline."
                actions={<ButtonLink href="/app/opportunities">Add a posting</ButtonLink>}
              />
            </div>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {matches.map((job, index) => (
                <JobMatchCard key={job.id} job={job} revealProgress={revealProgress} stagger={index * 0.09} />
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="all-apps-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="all-apps-heading" className="text-base font-semibold tracking-tight text-ink">
                All applications
              </h2>
              <p className="mt-1 text-xs text-ink-muted">
                Includes roles saved or filled from the browser extension — one tracker for everything.
              </p>
            </div>
            <ButtonLink href="/app/applications" variant="secondary" size="sm">
              Open Tracker
            </ButtonLink>
          </div>

          <div className="mt-3 sm:hidden">
            <label className="relative block">
              <span className="sr-only">Search applications</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by title, company…"
                className="w-full rounded-full border border-line bg-[#fafbf8] py-2 pl-10 pr-4 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-ink/30 focus:bg-white"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                  filter === item.id
                    ? "bg-[#1a3329] text-white"
                    : "border border-line bg-white text-ink-muted hover:text-ink",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                eyebrow="Applications"
                title={applications.length === 0 ? "No applications yet" : "No matches for this filter"}
                body={
                  applications.length === 0
                    ? "Save a job page from the extension or add a posting on the site. Both land in this list."
                    : "Try another filter or clear the search."
                }
                actions={
                  applications.length === 0 ? (
                    <ButtonLink href="/app/opportunities">Add a posting</ButtonLink>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="mt-4">
              <ApplicationsTrackerTable rows={filtered} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function JobMatchCard({
  job,
  revealProgress,
  stagger,
}: {
  job: DashboardMatch;
  revealProgress: number;
  stagger: number;
}) {
  const target = job.match ?? 0;
  const cardProgress = Math.min(1, Math.max(0, (revealProgress - stagger) / Math.max(0.001, 1 - stagger)));
  const display = target * cardProgress;
  const isSubmitted =
    job.status === "submitted" || job.statusLabel.toLowerCase() === "submitted";

  return (
    <article className={cn("flex min-h-[10.5rem] flex-col rounded-2xl border p-4", CARD_TONES[job.tone])}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-ink-muted">{job.company}</p>
          <h3 className="mt-1 text-sm font-semibold leading-snug tracking-tight text-ink">{job.role}</h3>
          {job.sourceLabel ? (
            <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">{job.sourceLabel}</p>
          ) : null}
        </div>
        <MatchRing percent={display} label={Math.round(display)} target={job.match} />
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line bg-white text-[10px] font-semibold text-ink">
            {job.company.slice(0, 2).toUpperCase()}
          </span>
          <span className="truncate text-xs font-medium text-ink-muted">{job.company.split(" ")[0]}</span>
        </div>
        {isSubmitted ? (
          <Link
            href={job.href}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
            Submitted
          </Link>
        ) : (
          <Link
            href={job.href}
            className="shrink-0 rounded-full bg-[#1a3329] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#142820]"
          >
            Apply
          </Link>
        )}
      </div>
    </article>
  );
}

function MatchRing({
  percent,
  label,
  target,
}: {
  percent: number;
  label: number;
  target: number | null;
}) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = c - (clamped / 100) * c;

  return (
    <div
      className="dashboard-match-ring relative h-11 w-11 shrink-0"
      aria-label={target == null ? "Match score pending" : `${Math.round(target)}% match`}
    >
      <svg viewBox="0 0 44 44" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="22" cy="22" r={r} fill="none" stroke="#e5e7eb" strokeWidth="3" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="#10b981"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="dashboard-match-ring-progress"
          style={{ transition: "stroke-dashoffset 140ms linear" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums text-ink">
        {target == null ? "—" : `${label}%`}
      </span>
    </div>
  );
}
