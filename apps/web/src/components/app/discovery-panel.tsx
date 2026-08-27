import { opportunityCategorySchema } from "@1apply/contracts";
import { computeDeadlineInfo, type RankedDiscovery } from "@1apply/domain";

import { ButtonLink, SubmitButton } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { queueDiscoveryRequest, saveDiscoveredOpportunity } from "@/server/opportunities/actions";
import { cn } from "@/lib/cn";

const TYPE_LABELS: Record<string, string> = {
  job: "Job",
  internship: "Internship",
  scholarship: "Scholarship",
  hackathon: "Hackathon",
  grant: "Grant",
  fellowship: "Fellowship",
  university: "University",
  accelerator: "Accelerator",
  conference: "Conference",
  ambassador: "Ambassador",
  visa: "Visa",
  other: "Other",
};

export function DiscoveryPanel({
  defaultQuery,
  results,
  summary,
}: {
  defaultQuery: string;
  results: RankedDiscovery[];
  summary: string | null;
}) {
  return (
    <div id="discovery" className="scroll-mt-24 rounded-2xl border border-line bg-[#fafbf8]/50 p-4 sm:p-5">
      <form action={queueDiscoveryRequest} className="grid gap-4">
        <Field label="What are you looking for?" htmlFor="discovery-query">
          <Textarea
            id="discovery-query"
            name="query"
            rows={2}
            required
            minLength={8}
            defaultValue={defaultQuery}
            placeholder="Find AI/ML internships in Pakistan or remote opportunities for undergraduate students."
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type filter" htmlFor="filter-category">
            <Select id="filter-category" name="filterCategory" defaultValue="">
              <option value="">Any type</option>
              {opportunityCategorySchema.options.map((category) => (
                <option key={category} value={category}>
                  {TYPE_LABELS[category] ?? category}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Location filter" htmlFor="filter-location">
            <Input id="filter-location" name="filterLocation" placeholder="Pakistan" />
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm text-ink">
            <input type="checkbox" name="filterRemote" className="h-4 w-4 rounded border-line" />
            Remote OK
          </label>
        </div>
        <SubmitButton pendingText="Searching & ranking…">Search and rank</SubmitButton>
      </form>

      {summary ? <p className="mt-4 text-sm text-ink-muted">{summary}</p> : null}

      {results.length > 0 ? (
        <ul className="mt-4 grid gap-2.5">
          {results.map((item) => (
            <li key={item.canonicalUrl}>
              <DiscoveryResultCard item={item} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function DiscoveryResultCard({ item }: { item: RankedDiscovery }) {
  const deadline = computeDeadlineInfo(item.deadlineAt, null);
  const fitTone =
    item.fitPreview == null
      ? "muted"
      : item.fitPreview >= 75
        ? "mint"
        : item.fitPreview >= 50
          ? "sand"
          : "coral";

  return (
    <article className="rounded-2xl border border-line bg-white px-3.5 py-3 transition-colors hover:bg-[#fafbf8]/60">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-white text-xs font-semibold text-ink">
          {(item.organization?.trim().charAt(0) || item.title.charAt(0) || "?").toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium leading-tight text-ink">
              {item.organization ?? "Unknown host"}
            </p>
            <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-700">
              {item.provider.replace(/_/g, " ")}
            </span>
            {item.alreadySaved ? (
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                Saved
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-muted">{item.title}</p>
          <p className="mt-1 text-[11px] text-ink-muted">
            {item.category.replace(/_/g, " ")}
            {item.location ? ` · ${item.location}` : ""}
            {item.remote ? " · remote" : ""}
            {" · "}
            {item.deadlineAt ? deadline.label : "No deadline listed"}
          </p>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-ink-muted">{item.excerpt}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
            <span className={cn("font-medium", fitTone === "mint" ? "text-emerald-700" : fitTone === "sand" ? "text-amber-800" : fitTone === "coral" ? "text-rose-700" : undefined)}>
              Fit preview · {item.fitPreview == null ? "—" : Math.round(item.fitPreview)}
            </span>
            <span>
              Rank {item.rank} · relevance {item.relevance}
            </span>
            <a
              href={item.sourceUrl}
              className="truncate font-medium text-ink hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              Source
            </a>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {item.alreadySaved && item.opportunityId ? (
              <>
                <ButtonLink href={`/app/opportunities/${item.opportunityId}`} size="sm" variant="secondary">
                  Open analysis
                </ButtonLink>
                <ButtonLink href="/app/applications" size="sm" variant="ghost">
                  Applications
                </ButtonLink>
              </>
            ) : (
              <form action={saveDiscoveredOpportunity}>
                <input type="hidden" name="sourceUrl" value={item.sourceUrl} />
                <input type="hidden" name="title" value={item.title} />
                <input type="hidden" name="organization" value={item.organization ?? ""} />
                <input type="hidden" name="excerpt" value={item.excerpt} />
                <input type="hidden" name="category" value={item.category} />
                <input type="hidden" name="location" value={item.location ?? ""} />
                <div className="flex flex-wrap gap-2">
                  <SubmitButton size="sm">Save opportunity</SubmitButton>
                  <SubmitButton size="sm" variant="secondary">
                    Analyze opportunity
                  </SubmitButton>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
