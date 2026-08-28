import Link from "next/link";
import { notFound } from "next/navigation";

import { FlashBanner } from "@/components/app/flash-banner";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { ButtonLink, SubmitButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { reanalyzeOpportunity, pasteIntoSavedOpportunity } from "@/server/opportunities/actions";
import { decodeHtmlEntities } from "@/server/ingest/fetch-page";
import { loadOpportunityDetail } from "@/server/opportunities/queries";

function analysisTone(status: string): "mint" | "sand" | "coral" | "muted" {
  if (status === "ready") return "mint";
  if (status === "pending") return "sand";
  if (status === "failed") return "coral";
  return "muted";
}

export default async function OpportunityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { id } = await params;
  const { notice, error } = await searchParams;
  const data = await loadOpportunityDetail(id);
  if (!data) notFound();

  const { opportunity, requirements, questions, documents, application, metadata } = data;

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Opportunity"
        title={opportunity.title}
        body={`${opportunity.organization ?? "Unknown organization"} · ${opportunity.category.replace(/_/g, " ")} · ${opportunity.source}`}
      />
      <p className="mt-2 text-sm">
        <Link href="/app/opportunities" className="text-teal underline">
          ← Back to opportunities
        </Link>
      </p>
      <FlashBanner notice={notice} error={error} />

      <div className="mt-8 grid max-w-4xl gap-6">
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">Analysis</h2>
              <p className="mt-1 text-sm text-ink-muted">
                {opportunity.location ? `${opportunity.location} · ` : ""}
                {opportunity.deadline_at
                  ? `Deadline ${new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(opportunity.deadline_at))}`
                  : "No deadline extracted"}
              </p>
              {opportunity.analyzed_at ? (
                <p className="mt-1 text-xs text-ink-muted">
                  Analyzed{" "}
                  {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
                    new Date(opportunity.analyzed_at),
                  )}
                </p>
              ) : null}
            </div>
            <StatusPill tone={analysisTone(opportunity.analysis_status)}>
              {opportunity.analysis_status.replace(/_/g, " ")}
            </StatusPill>
          </div>

          {opportunity.source_url ? (
            <p className="mt-3 text-sm">
              Source:{" "}
              <a href={opportunity.source_url} className="text-teal underline" target="_blank" rel="noreferrer">
                {opportunity.canonical_url ?? opportunity.source_url}
              </a>
            </p>
          ) : null}

          {metadata.analysisError ? (
            <p className="mt-3 text-sm text-coral">{metadata.analysisError}</p>
          ) : null}
          {metadata.fetchError ? (
            <p className="mt-3 text-sm text-coral">
              Fetch failed ({metadata.fetchError}). Paste the posting below so analysis can continue without inventing a listing.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {application ? (
              <ButtonLink href={`/app/applications/${application.id}`}>Open application workspace</ButtonLink>
            ) : null}
            {opportunity.raw_excerpt ? (
              <form action={reanalyzeOpportunity}>
                <input type="hidden" name="opportunityId" value={opportunity.id} />
                <SubmitButton variant="secondary" pendingText="Re-analyzing…">
                  Re-analyze stored content
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </Card>

        {opportunity.analysis_status === "needs_input" || opportunity.analysis_status === "failed" || !opportunity.raw_excerpt ? (
          <Card className="p-6">
            <h2 className="text-lg font-medium">Paste posting text</h2>
            <p className="mt-2 text-sm text-ink-muted">
              If the host page is login-gated or blocked, paste the public posting here. 1-Apply will analyze this text instead of inventing a listing.
            </p>
            <form action={pasteIntoSavedOpportunity} className="mt-4 grid gap-4">
              <input type="hidden" name="opportunityId" value={opportunity.id} />
              <Field label="Posting text" htmlFor="paste-into-opportunity">
                <Textarea
                  id="paste-into-opportunity"
                  name="pastedText"
                  rows={8}
                  required
                  minLength={40}
                  placeholder="Paste the full posting here…"
                />
              </Field>
              <SubmitButton variant="secondary" pendingText="Analyzing…">
                Analyze pasted text
              </SubmitButton>
            </form>
          </Card>
        ) : null}

        <Card className="p-6">
          <h2 className="text-lg font-medium">Requirements ({requirements.length})</h2>
          {requirements.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No structured requirements yet.</p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {requirements.map((item) => (
                <li key={item.id} className="rounded-lg border border-line/60 px-3 py-2 text-sm">
                  <p>{item.text}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {item.kind}
                    {item.hard ? " · hard requirement" : ""}
                    {item.source_span ? ` · ${item.source_span}` : ""}
                    {typeof item.confidence === "number" ? ` · confidence ${Math.round(item.confidence * 100)}%` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <h2 className="text-lg font-medium">Application questions ({questions.length})</h2>
            {questions.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">None extracted.</p>
            ) : (
              <ol className="mt-4 grid gap-2 list-decimal pl-5">
                {questions.map((item) => (
                  <li key={item.id} className="text-sm">
                    {item.prompt}
                    {item.limit_value ? (
                      <span className="text-ink-muted">{` · limit ${item.limit_value} ${item.limit_unit ?? "chars"}`}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-medium">Required documents ({documents.length})</h2>
            {documents.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">None listed.</p>
            ) : (
              <ul className="mt-4 grid gap-2">
                {documents.map((item) => (
                  <li key={item.id} className="text-sm">
                    {item.label}
                    <span className="text-ink-muted">{item.required ? " · required" : " · optional"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {(metadata.skills?.length ?? 0) > 0 || (metadata.experienceRequirements?.length ?? 0) > 0 ? (
          <Card className="p-6">
            <h2 className="text-lg font-medium">Skills and experience signals</h2>
            {metadata.skills && metadata.skills.length > 0 ? (
              <p className="mt-2 text-sm">
                <span className="font-medium">Skills:</span> {metadata.skills.join(", ")}
              </p>
            ) : null}
            {metadata.experienceRequirements && metadata.experienceRequirements.length > 0 ? (
              <ul className="mt-3 grid gap-1 text-sm">
                {metadata.experienceRequirements.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}

        {opportunity.raw_excerpt ? (
          <Card className="p-6">
            <h2 className="text-lg font-medium">Original reference excerpt</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm text-ink-muted">
              {decodeHtmlEntities(opportunity.raw_excerpt).slice(0, 4000)}
            </p>
          </Card>
        ) : null}
      </div>
    </WorkspaceMain>
  );
}
