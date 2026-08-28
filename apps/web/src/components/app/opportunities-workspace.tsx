"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import {
  OpportunitiesTrackerTable,
  type OpportunitiesTrackerRow,
} from "@/components/app/opportunities-tracker-table";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { cn } from "@/lib/cn";

const ADD_TABS = [
  { id: "url" as const, label: "Paste a link" },
  { id: "manual" as const, label: "Manual entry" },
  { id: "paste" as const, label: "Paste posting text" },
];

export function OpportunitiesWorkspace({
  flash,
  urlForm,
  manualForm,
  pasteForm,
  discovery,
  rows,
}: {
  flash?: ReactNode;
  urlForm: ReactNode;
  manualForm: ReactNode;
  pasteForm: ReactNode;
  discovery: ReactNode;
  rows: OpportunitiesTrackerRow[];
}) {
  const [tab, setTab] = useState<(typeof ADD_TABS)[number]["id"]>("url");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      `${row.company} ${row.role} ${row.category} ${row.location ?? ""} ${row.statusLabel} ${row.sourceLabel ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [query, rows]);

  return (
    <div className="min-h-full bg-white">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-6 lg:px-8">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-ink">Add a posting</h1>
          <p className="truncate text-xs text-ink-muted">
            Paste a URL, enter details, or discover roles — then track them with applications.
          </p>
        </div>
        <label className="mx-auto hidden max-w-md flex-1 sm:block">
          <span className="sr-only">Search saved postings</span>
          <span className="relative block">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search saved postings…"
              className="w-full rounded-full border border-line bg-[#fafbf8] py-2 pl-10 pr-4 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-ink/30 focus:bg-white"
            />
          </span>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <ButtonLink href="/app/applications" size="sm" variant="secondary">
            Applications
          </ButtonLink>
          <ButtonLink href="/app" size="sm" variant="ghost">
            Dashboard
          </ButtonLink>
        </div>
      </header>

      <div className="space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        {flash}

        <section aria-labelledby="add-posting-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="add-posting-heading" className="text-base font-semibold tracking-tight text-ink">
                Bring a posting in
              </h2>
              <p className="mt-1 text-xs text-ink-muted">
                Public URLs are fetched and analyzed. Login-gated pages can be pasted as text.
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {ADD_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                  tab === item.id
                    ? "bg-[#1a3329] text-white"
                    : "border border-line bg-white text-ink-muted hover:text-ink",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-line bg-[#fafbf8]/50 p-4 sm:p-5">
            {tab === "url" ? urlForm : null}
            {tab === "manual" ? manualForm : null}
            {tab === "paste" ? pasteForm : null}
          </div>
        </section>

        <section aria-labelledby="discover-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="discover-heading" className="text-base font-semibold tracking-tight text-ink">
                Discover opportunities
              </h2>
              <p className="mt-1 text-xs text-ink-muted">
                Natural-language search over public boards. Fit preview uses Your kit only.
              </p>
            </div>
            <Link href="#discovery" className="text-sm font-medium text-ink-muted hover:text-ink">
              Jump to search →
            </Link>
          </div>
          <div className="mt-3">{discovery}</div>
        </section>

        <section aria-labelledby="saved-postings-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="saved-postings-heading" className="text-base font-semibold tracking-tight text-ink">
                Saved postings
              </h2>
              <p className="mt-1 text-xs text-ink-muted">
                Includes roles saved from the extension or added here — one list for everything.
              </p>
            </div>
            <p className="rounded-full bg-[#fafbf8] px-2.5 py-1 font-mono text-[11px] text-ink-muted ring-1 ring-line">
              {filtered.length}
            </p>
          </div>

          <div className="mt-3 sm:hidden">
            <label className="relative block">
              <span className="sr-only">Search saved postings</span>
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search saved postings…"
                className="w-full rounded-full border border-line bg-[#fafbf8] py-2 pl-10 pr-4 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-ink/30 focus:bg-white"
              />
            </label>
          </div>

          {filtered.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                eyebrow="Postings"
                title={rows.length === 0 ? "No opportunities yet" : "No matches for this search"}
                body={
                  rows.length === 0
                    ? "Paste a public URL, enter a posting manually, or save one from the extension."
                    : "Try another search term."
                }
              />
            </div>
          ) : (
            <div className="mt-4">
              <OpportunitiesTrackerTable rows={filtered} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
