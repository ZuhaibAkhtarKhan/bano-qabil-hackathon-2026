import { opportunityCategorySchema } from "@1apply/contracts";
import { computeDeadlineInfo, type RankedDiscovery } from "@1apply/domain";

import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScoreIndicator } from "@/components/ui/data";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { queueDiscoveryRequest, saveDiscoveredOpportunity } from "@/server/opportunities/actions";

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
    <Card id="discovery" className="mt-6 max-w-5xl scroll-mt-24 p-6">
      <h2 className="font-display text-2xl">Discover opportunities</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Natural-language search over sourced program pages and your saved opportunities. Listings keep their source URL.
        Fit Index is a preview from verified Application Memory — nothing is invented.
      </p>
      <form action={queueDiscoveryRequest} className="mt-4 grid gap-4">
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
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" name="filterRemote" className="h-4 w-4" />
            Remote OK
          </label>
        </div>
        <Button type="submit">Search and rank</Button>
      </form>
      {summary ? <p className="mt-4 text-sm text-ink-muted">{summary}</p> : null}
      {results.length > 0 ? (
        <ul className="mt-6 grid gap-4">
          {results.map((item) => (
            <li key={item.canonicalUrl}>
              <DiscoveryResultCard item={item} />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function DiscoveryResultCard({ item }: { item: RankedDiscovery }) {
  const deadline = computeDeadlineInfo(item.deadlineAt, null);
  return (
    <Card as="article" className="border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-medium">{item.title}</h3>
          <p className="mt-1 text-sm text-ink-muted">
            {item.organization ?? "Unknown host"} · {item.category.replace(/_/g, " ")}
            {item.location ? ` · ${item.location}` : ""}
            {item.remote ? " · remote" : ""}
            {item.alreadySaved ? " · already saved" : ""}
          </p>
        </div>
        <StatusPill tone="muted">{item.provider.replace(/_/g, " ")}</StatusPill>
      </div>
      <p className="mt-3 text-sm">{item.excerpt}</p>
      <p className="mt-2 text-xs text-ink-muted">
        Source:{" "}
        <a href={item.sourceUrl} className="underline" target="_blank" rel="noreferrer">
          {item.sourceUrl}
        </a>
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <ScoreIndicator score={item.fitPreview} label="Fit preview" />
        <div className="grid gap-1 text-sm">
          <p>
            Rank {item.rank} · relevance {item.relevance}
            {item.eligibilityPreview !== null ? ` · eligibility ${item.eligibilityPreview}` : ""}
          </p>
          <p className="text-ink-muted">
            Deadline: {item.deadlineAt ? deadline.label : "Not published on this source card"}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
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
              <Button type="submit" size="sm">
                Save opportunity
              </Button>
              <Button type="submit" size="sm" variant="secondary">
                Analyze opportunity
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
