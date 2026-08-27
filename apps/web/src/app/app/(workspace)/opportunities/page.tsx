import { opportunityCategorySchema } from "@1apply/contracts";

import { DiscoveryPanel } from "@/components/app/discovery-panel";
import { FlashBanner } from "@/components/app/flash-banner";
import {
  toOpportunitiesTrackerRow,
} from "@/components/app/opportunities-tracker-table";
import { OpportunitiesWorkspace } from "@/components/app/opportunities-workspace";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import {
  createManualOpportunity,
  ingestOpportunityUrl,
  ingestPastedOpportunity,
} from "@/server/opportunities/actions";
import { loadDiscoveryWorkspace } from "@/server/opportunities/queries";
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
  searchParams: Promise<{ notice?: string; error?: string; discovery?: string }>;
}) {
  const { notice, error, discovery } = await searchParams;
  const [{ opportunities, applicationByOpportunity }, discoveryWorkspace] = await Promise.all([
    loadOpportunitiesWorkspace(),
    loadDiscoveryWorkspace(discovery),
  ]);

  const rows = opportunities.map((item) =>
    toOpportunitiesTrackerRow(item, applicationByOpportunity.get(item.id) ?? null),
  );

  return (
    <main id="main">
      <OpportunitiesWorkspace
        flash={
          notice || error ? (
            <div className="-mt-2">
              <FlashBanner notice={notice} error={error} />
            </div>
          ) : null
        }
        rows={rows}
        urlForm={
          <form action={ingestOpportunityUrl} className="grid max-w-xl gap-4">
            <Field label="Opportunity URL" htmlFor="opportunity-url" hint="Public http(s) URLs only.">
              <Input id="opportunity-url" name="url" type="url" required placeholder="https://" />
            </Field>
            <SubmitButton pendingText="Fetching & analyzing…">Fetch and analyze</SubmitButton>
          </form>
        }
        manualForm={
          <form action={createManualOpportunity} className="grid gap-4 lg:grid-cols-2">
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
            <div className="lg:col-span-2">
              <Field label="Requirements (one per line)" htmlFor="opportunity-requirements">
                <Textarea id="opportunity-requirements" name="requirements" rows={3} />
              </Field>
            </div>
            <div className="lg:col-span-2">
              <Field label="Questions (one per line)" htmlFor="opportunity-questions">
                <Textarea id="opportunity-questions" name="questions" rows={3} />
              </Field>
            </div>
            <div className="lg:col-span-2">
              <Field label="Required documents (one per line)" htmlFor="opportunity-documents">
                <Textarea
                  id="opportunity-documents"
                  name="documents"
                  rows={2}
                  placeholder="Resume, transcript, cover letter"
                />
              </Field>
            </div>
            <div className="lg:col-span-2">
              <Field label="Notes / pasted text" htmlFor="opportunity-notes">
                <Textarea id="opportunity-notes" name="notes" rows={2} />
              </Field>
            </div>
            <div className="lg:col-span-2">
              <SubmitButton variant="secondary">Save opportunity</SubmitButton>
            </div>
          </form>
        }
        pasteForm={
          <form action={ingestPastedOpportunity} className="grid max-w-2xl gap-4">
            <Field label="Short title" htmlFor="paste-title">
              <Input id="paste-title" name="title" required placeholder="AI/ML internship" />
            </Field>
            <Field label="Original URL (optional)" htmlFor="paste-source-url">
              <Input id="paste-source-url" name="sourceUrl" type="url" placeholder="https://" />
            </Field>
            <Field
              label="Posting text"
              htmlFor="paste-text"
              hint="Use when the URL is login-gated or blocked. Minimum 40 characters."
            >
              <Textarea
                id="paste-text"
                name="pastedText"
                rows={6}
                required
                placeholder="Paste the full posting here…"
              />
            </Field>
            <SubmitButton variant="secondary">Analyze pasted content</SubmitButton>
          </form>
        }
        discovery={
          <DiscoveryPanel
            defaultQuery={
              (discoveryWorkspace.active?.query as string | undefined) ??
              "Find AI/ML internships in Pakistan or remote opportunities for undergraduate students."
            }
            results={discoveryWorkspace.results}
            summary={(discoveryWorkspace.active?.result_summary as string | null) ?? null}
          />
        }
      />
    </main>
  );
}
