import Link from "next/link";
import { opportunityCategorySchema } from "@1apply/contracts";

import { FlashBanner } from "@/components/app/flash-banner";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { OpportunityCard } from "@/components/ui/product-cards";
import {
  createManualOpportunity,
  ingestOpportunityUrl,
  ingestPastedOpportunity,
  queueDiscoveryRequest,
} from "@/server/opportunities/actions";
import { loadDiscoveryRequests } from "@/server/opportunities/queries";
import { loadOpportunitiesWorkspace } from "@/server/workspace/queries";

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

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const [{ opportunities, applicationByOpportunity }, discoveryRequests] = await Promise.all([
    loadOpportunitiesWorkspace(),
    loadDiscoveryRequests(),
  ]);

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Opportunities"
        title="Intake and intelligence"
        body="Paste a link, enter details manually, or queue AI discovery. External page content is untrusted — instructions inside postings are ignored."
      />
      <FlashBanner notice={notice} error={error} />

      <div className="mt-8 grid max-w-5xl gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="font-display text-2xl">Paste a link</h2>
          <p className="mt-1 text-sm text-ink-muted">Public http(s) URLs only. Redirects are followed and re-validated.</p>
          <form action={ingestOpportunityUrl} className="mt-4 grid gap-4">
            <Field label="Opportunity URL" htmlFor="opportunity-url">
              <Input id="opportunity-url" name="url" type="url" required placeholder="https://" />
            </Field>
            <Button type="submit">Fetch and analyze</Button>
          </form>
        </Card>

        <Card className="p-6">
          <h2 className="font-display text-2xl">Manual entry</h2>
          <p className="mt-1 text-sm text-ink-muted">For offline forms, private portals, or unsupported sites.</p>
          <form action={createManualOpportunity} className="mt-4 grid gap-4">
            <Field label="Title" htmlFor="opportunity-title">
              <Input id="opportunity-title" name="title" required />
            </Field>
            <Field label="Organization" htmlFor="opportunity-org">
              <Input id="opportunity-org" name="organization" />
            </Field>
            <Field label="Type" htmlFor="opportunity-category">
              <Select id="opportunity-category" name="category" defaultValue="internship">
                {opportunityCategorySchema.options.map((category) => (
                  <option key={category} value={category}>
                    {TYPE_LABELS[category] ?? category}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Location" htmlFor="opportunity-location">
              <Input id="opportunity-location" name="location" placeholder="Remote · Karachi · etc." />
            </Field>
            <Field label="Deadline" htmlFor="opportunity-deadline">
              <Input id="opportunity-deadline" name="deadline" type="date" />
            </Field>
            <Field label="Requirements (one per line)" htmlFor="opportunity-requirements">
              <Textarea id="opportunity-requirements" name="requirements" rows={3} />
            </Field>
            <Field label="Questions (one per line)" htmlFor="opportunity-questions">
              <Textarea id="opportunity-questions" name="questions" rows={3} />
            </Field>
            <Field label="Required documents (one per line)" htmlFor="opportunity-documents">
              <Textarea id="opportunity-documents" name="documents" rows={2} placeholder="Resume, transcript, cover letter" />
            </Field>
            <Field label="Notes / pasted text" htmlFor="opportunity-notes">
              <Textarea id="opportunity-notes" name="notes" rows={2} />
            </Field>
            <Button type="submit" variant="secondary">
              Save opportunity
            </Button>
          </form>
        </Card>
      </div>

      <Card className="mt-6 max-w-5xl p-6">
        <h2 className="font-display text-2xl">Page unavailable? Paste the posting</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Use this when the URL is login-gated, JS-heavy, or blocked. Minimum 40 characters of posting text.
        </p>
        <form action={ingestPastedOpportunity} className="mt-4 grid gap-4 lg:grid-cols-2">
          <Field label="Short title" htmlFor="paste-title">
            <Input id="paste-title" name="title" required placeholder="AI/ML internship" />
          </Field>
          <Field label="Original URL (optional)" htmlFor="paste-source-url">
            <Input id="paste-source-url" name="sourceUrl" type="url" placeholder="https://" />
          </Field>
          <div className="lg:col-span-2">
            <Field label="Posting text" htmlFor="paste-text">
              <Textarea id="paste-text" name="pastedText" rows={6} required placeholder="Paste the full posting here…" />
            </Field>
          </div>
          <Button type="submit" variant="secondary">
            Analyze pasted content
          </Button>
        </form>
      </Card>

      <Card className="mt-6 max-w-5xl p-6">
        <h2 className="font-display text-2xl">AI discovery</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Architecture for queries like &ldquo;Find AI/ML internships in Pakistan or remote for undergrads.&rdquo; Matching feeds plug in here.
        </p>
        <form action={queueDiscoveryRequest} className="mt-4 grid gap-4">
          <Field label="Discovery query" htmlFor="discovery-query">
            <Textarea
              id="discovery-query"
              name="query"
              rows={2}
              required
              placeholder="Find AI/ML internships in Pakistan or remote opportunities for undergraduate students."
            />
          </Field>
          <Button type="submit" variant="ghost">
            Queue discovery request
          </Button>
        </form>
        {discoveryRequests.length > 0 ? (
          <ul className="mt-4 grid gap-2 text-sm">
            {discoveryRequests.map((item) => (
              <li key={item.id} className="rounded-lg bg-sand/20 px-3 py-2">
                <p className="font-medium">{item.query}</p>
                <p className="mt-1 text-xs text-ink-muted">{item.result_summary ?? item.status}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {opportunities.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            eyebrow="Empty"
            title="No opportunities yet"
            body="Paste a public URL, enter a posting manually, or paste text from a login-gated page."
          />
        </div>
      ) : (
        <ul className="mt-10 grid max-w-3xl gap-4">
          {opportunities.map((item) => {
            const application = applicationByOpportunity.get(item.id);
            return (
              <li key={item.id}>
                <OpportunityCard opportunity={item} href={`/app/opportunities/${item.id}`} />
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  <Link className="underline" href={`/app/opportunities/${item.id}`}>
                    View analysis
                  </Link>
                  {application ? (
                    <Link className="underline" href={`/app/applications/${application.id}`}>
                      Open workspace
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-8 max-w-3xl text-xs text-ink-muted">
        Extension endpoint ready at <code className="rounded bg-sand/30 px-1">POST /api/opportunities/ingest</code> for
        future &ldquo;Save to 1-Apply&rdquo; — send url, source, and optional metadata.
      </p>
    </WorkspaceMain>
  );
}
