"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Wordmark } from "@/components/brand/wordmark";
import { cn } from "@/lib/cn";

const LIVE_ACTIVITY_MESSAGES = [
  "Uploading résumé and cover letter…",
  "Tailoring résumé to role requirements…",
  "Grounding cover letter in your evidence…",
  "Checking fit against stored skills…",
  "Preparing autofill preview…",
] as const;

const TOP_MATCHES = [
  {
    id: "systems",
    company: "Systems Limited",
    role: "Software Engineer II",
    match: 71,
    tone: "sand" as const,
    logo: "/logos/systems-limited.png",
  },
  {
    id: "tkxel",
    company: "Tkxel",
    role: "Full Stack Developer",
    match: 80,
    tone: "mint" as const,
    logo: "/logos/tkxel.png",
  },
  {
    id: "bano-qabil",
    company: "Bano Qabil Hackathon",
    role: "AI Track Fellow",
    match: 64,
    tone: "violet" as const,
    logo: "/logos/bano-qabil-badge.svg",
  },
  {
    id: "10pearls",
    company: "10Pearls",
    role: "Junior Software Developer",
    match: 58,
    tone: "coral" as const,
    logo: "/logos/10pearls.png",
  },
] as const;

const APPLICATIONS = [
  {
    id: "app-systems",
    company: "Systems Limited",
    role: "Software Engineer II",
    resume: "Ready",
    cover: "Ready",
    status: { label: "Submitted", tone: "mint" as const },
    applied: "2 days ago",
    logo: "/logos/systems-limited.png",
    live: false,
  },
  {
    id: "app-tkxel",
    company: "Tkxel",
    role: "Backend Developer",
    resume: "Ready",
    cover: "Off",
    status: { label: "Submitted", tone: "mint" as const },
    applied: "1 day ago",
    logo: "/logos/tkxel.png",
    live: false,
  },
  {
    id: "app-bano",
    company: "Bano Qabil Hackathon",
    role: "AI Track Fellow",
    resume: "Default",
    cover: "Ready",
    status: { label: "Tailoring resume", tone: "teal" as const },
    applied: "3 hours ago",
    logo: "/logos/bano-qabil-badge.svg",
    live: true,
  },
  {
    id: "app-10pearls",
    company: "10Pearls",
    role: "Junior Developer",
    resume: "Ready",
    cover: "Ready",
    status: { label: "Needs you", tone: "coral" as const },
    applied: "5 hours ago",
    logo: "/logos/10pearls.png",
    live: false,
  },
  {
    id: "app-honhaar",
    company: "Honhaar Scholarship",
    role: "STEM Undergraduate Award",
    resume: "Default",
    cover: "Off",
    status: { label: "Queued", tone: "sand" as const },
    applied: "Just now",
    logo: "/logos/honhaar-scholarship.svg",
    live: false,
  },
] as const;

const CARD_TONES = {
  sand: "bg-[#fef9e8] border-[#f5e6b8]",
  mint: "bg-[#eef8f0] border-[#cce8d4]",
  violet: "bg-[#f3f0ff] border-[#ddd6fe]",
  coral: "bg-[#fff1f2] border-[#fecdd3]",
} as const;

const STATUS_DOT = {
  mint: "bg-emerald-500",
  teal: "bg-cyan-500",
  coral: "bg-rose-500",
  sand: "bg-amber-500",
} as const;

/** Sample dashboard — peeks under hero; match rings fill on scroll. */
export const ApplicationQueuePreview = forwardRef<
  HTMLDivElement,
  { animationEpoch?: number }
>(function ApplicationQueuePreview({ animationEpoch = 0 }, ref) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [mountNode, setMountNode] = useState<HTMLDivElement | null>(null);
  const [revealProgress, setRevealProgress] = useState(0);
  const targetProgressRef = useRef(0);
  const smoothProgressRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node;
      setMountNode(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  useLayoutEffect(() => {
    const node = mountNode;
    if (!node) return;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const measureTarget = () => {
      const rect = node.getBoundingClientRect();
      const vh = window.innerHeight;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (reduced && rect.top < vh * 0.85) {
        targetProgressRef.current = 1;
        return;
      }

      const startY = vh * 0.95;
      const endY = vh * 0.38;
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

    const restart = () => {
      smoothProgressRef.current = 0;
      targetProgressRef.current = 0;
      setRevealProgress(0);
      measureTarget();
    };

    restart();
    rafRef.current = window.requestAnimationFrame(tick);

    const onPageShow = () => restart();
    const onPopState = () => restart();

    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("focus", restart);

    return () => {
      running = false;
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("focus", restart);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [mountNode, animationEpoch]);

  const inView = revealProgress > 0.08;

  return (
    <section
      aria-labelledby="dashboard-heading"
      className="dashboard-preview-section relative z-20 -mt-14 px-4 pb-20 sm:-mt-16 sm:px-6"
    >
      <div
        ref={setRefs}
        className="dashboard-preview-shell mx-auto max-w-6xl overflow-hidden rounded-[1.25rem] border border-line bg-white shadow-[0_28px_90px_-42px_rgba(14,14,14,0.35)]"
      >
        <div className="dashboard-preview-layout flex min-h-[520px]">
          <DashboardSidebar />
          <DashboardMain inView={inView} revealProgress={revealProgress} animationEpoch={animationEpoch} />
        </div>
      </div>
      <p id="dashboard-heading" className="sr-only">
        Sample 1-Apply dashboard
      </p>
    </section>
  );
});

function DashboardSidebar() {
  const nav = [
    { label: "Dashboard", active: true },
    { label: "Browse jobs", badge: null },
    { label: "Applications", badge: "47" },
    { label: "Inbox", badge: "3" },
    { label: "Tracker", badge: null },
  ];

  return (
    <aside className="dashboard-preview-sidebar hidden w-[210px] shrink-0 flex-col border-r border-line bg-[#fafbf8] lg:flex">
      <div className="border-b border-line px-4 py-4">
        <Wordmark size="sm" />
      </div>

      <nav className="flex-1 px-3 py-4">
        <ul className="space-y-0.5">
          {nav.map((item) => (
            <li key={item.label}>
              <span
                className={cn(
                  "flex items-center justify-between rounded-lg px-2.5 py-2 text-sm",
                  item.active ? "bg-white font-medium text-ink shadow-sm" : "text-ink-muted",
                )}
              >
                {item.label}
                {item.badge ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                    {item.badge}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>

        <ul className="mt-6 space-y-0.5 border-t border-line pt-4">
          {["Profile", "Settings"].map((label) => (
            <li key={label}>
              <span className="block rounded-lg px-2.5 py-2 text-sm text-ink-muted">{label}</span>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-auto space-y-3 border-t border-line p-3">
        <p className="rounded-lg bg-white px-2.5 py-2 text-xs text-ink-muted shadow-sm">Help &amp; support</p>
        <div className="rounded-xl bg-[#1a3329] px-3 py-3 text-white">
          <p className="text-sm font-semibold">Zuhaib Akhtar</p>
          <p className="text-xs text-white/70">500 credits</p>
        </div>
      </div>
    </aside>
  );
}

function DashboardMain({
  inView,
  revealProgress,
  animationEpoch,
}: {
  inView: boolean;
  revealProgress: number;
  animationEpoch: number;
}) {
  const [activityIndex, setActivityIndex] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const id = window.setInterval(() => {
      setActivityIndex((i) => (i + 1) % LIVE_ACTIVITY_MESSAGES.length);
    }, 2400);
    return () => window.clearInterval(id);
  }, [inView]);

  return (
    <div className="dashboard-preview-main min-w-0 flex-1 bg-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
        <h2 className="text-lg font-semibold tracking-tight">Dashboard</h2>
        <div className="mx-auto hidden max-w-md flex-1 sm:block" aria-hidden="true">
          <div className="pointer-events-none select-none w-full rounded-full border border-line bg-[#fafbf8] px-4 py-2 text-sm text-ink-muted">
            Search by title, company…
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-ink-muted">
            <IconBell />
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden="true" />
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-ink-muted">
            <IconHelp />
          </span>
        </div>
      </header>

      <div className="space-y-6 px-4 py-5 sm:px-5">
        <section aria-labelledby="top-matches-heading">
          <h3 id="top-matches-heading" className="text-base font-semibold tracking-tight">
            Top job matches
          </h3>
          <div className="dashboard-match-grid mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {TOP_MATCHES.map((job, index) => (
              <JobMatchCard
                key={`${job.id}-${animationEpoch}`}
                job={job}
                revealProgress={revealProgress}
                stagger={index * 0.09}
              />
            ))}
          </div>
        </section>

        <section aria-labelledby="all-apps-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="all-apps-heading" className="text-base font-semibold tracking-tight">
              All applications
            </h3>
            <div className="flex gap-2">
              <button type="button" className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-muted">
                Open Tracker
              </button>
              <button
                type="button"
                className="rounded-lg bg-[#1a3329] px-3 py-1.5 text-xs font-semibold text-white"
              >
                Submit all
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {["All", "In flight", "Needs you", "Failed", "Skipped"].map((filter, i) => (
              <span
                key={filter}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium",
                  i === 0 ? "bg-ink text-white" : "border border-line bg-white text-ink-muted",
                )}
              >
                {filter}
              </span>
            ))}
          </div>

          <div className="mt-3 overflow-x-auto rounded-xl border border-line">
            <table className="dashboard-apps-table w-full min-w-[640px] table-fixed text-left text-sm">
              <thead className="border-b border-line bg-[#fafbf8] text-[11px] uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="w-[34%] px-4 py-2.5 font-medium">Position</th>
                  <th className="w-[12%] px-4 py-2.5 font-medium">Resume</th>
                  <th className="w-[14%] px-4 py-2.5 font-medium">Cover letter</th>
                  <th className="w-[18%] px-4 py-2.5 font-medium">Status</th>
                  <th className="w-[22%] px-4 py-2.5 font-medium">Applied</th>
                </tr>
              </thead>
              <tbody>
                {APPLICATIONS.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <CompanyLogo src={row.logo} alt="" />
                        <div className="min-w-0">
                          <p className="truncate font-medium leading-tight">{row.company}</p>
                          <p className="truncate text-xs text-ink-muted">{row.role}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{row.resume}</td>
                    <td className="px-4 py-3 text-ink-muted">{row.cover}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[row.status.tone])} aria-hidden="true" />
                        <span className="truncate">{row.status.label}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="dashboard-applied-cell">
                        {row.live && inView ? (
                          <LiveActivityText message={LIVE_ACTIVITY_MESSAGES[activityIndex] ?? LIVE_ACTIVITY_MESSAGES[0]} />
                        ) : (
                          <span className="block truncate text-xs text-ink-muted">{row.applied}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
  job: (typeof TOP_MATCHES)[number];
  revealProgress: number;
  stagger: number;
}) {
  const cardProgress = Math.min(1, Math.max(0, (revealProgress - stagger) / (1 - stagger)));
  const display = job.match * cardProgress;
  const label = Math.round(display);

  return (
    <article className={cn("dashboard-match-card flex flex-col rounded-xl border p-3.5", CARD_TONES[job.tone])}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{job.company}</p>
          <h4 className="mt-1 text-sm font-semibold leading-snug tracking-tight">{job.role}</h4>
        </div>
        <MatchRing percent={display} label={label} target={job.match} />
      </div>
      <div className="mt-auto flex items-center justify-between pt-4">
        <div className="flex items-center gap-2">
          <CompanyLogo src={job.logo} alt="" size="sm" />
          <span className="text-xs font-medium text-ink-muted">{job.company.split(" ")[0]}</span>
        </div>
        <button type="button" className="rounded-lg bg-[#1a3329] px-3 py-1.5 text-xs font-semibold text-white">
          Apply
        </button>
      </div>
    </article>
  );
}

function CompanyLogo({ src, alt, size = "md" }: { src: string; alt: string; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-6 w-6" : "h-8 w-8";
  return (
    // eslint-disable-next-line @next/next/no-img-element -- marketing demo logos
    <img src={src} alt={alt} width={size === "sm" ? 24 : 32} height={size === "sm" ? 24 : 32} className={cn("rounded-md border border-line bg-white object-contain p-0.5", dim)} />
  );
}

function MatchRing({ percent, label, target }: { percent: number; label: number; target: number }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const offset = c - (percent / 100) * c;

  return (
    <div className="dashboard-match-ring relative h-11 w-11 shrink-0" aria-label={`${target}% match`}>
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
          style={{
            transition: "stroke-dashoffset 140ms linear",
          }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums text-ink">
        {label}%
      </span>
    </div>
  );
}

function LiveActivityText({ message }: { message: string }) {
  return (
    <span className="dashboard-live-activity inline-flex w-full min-w-0 items-center gap-1.5 text-xs text-cyan-700">
      <span className="dashboard-live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{message}</span>
    </span>
  );
}

function IconBell() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5v2.1l-.8 1.6a.75.75 0 0 0 .67 1.08h9.26a.75.75 0 0 0 .67-1.08l-.8-1.6V6A4.5 4.5 0 0 0 8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconHelp() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6.2 6.1a1.9 1.9 0 0 1 3.6.7c0 1.2-1.8 1.4-1.8 2.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="8" cy="11.8" r=".75" fill="currentColor" />
    </svg>
  );
}
