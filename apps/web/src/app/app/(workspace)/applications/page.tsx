import { opportunityCategorySchema } from "@1apply/contracts";

import {
  ApplicationsTrackerBoard,
  ApplicationsTrackerTable,
} from "@/components/app/applications-tracker-table";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { ButtonLink, SubmitButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { applicationStatusLabel, normalizeApplicationStatus } from "@/lib/application-workflow";
import { toApplicationsTrackerRow, withNeedsYouFieldCount } from "@/lib/dashboard-display";
import { loadNeedsYouFieldCounts } from "@/server/needs-you/queries";
import { loadApplicationsWorkspace } from "@/server/workspace/queries";

function numericFit(row: Awaited<ReturnType<typeof loadApplicationsWorkspace>>["applications"][number]) {
  const value = Array.isArray(row.fit_evaluations) ? row.fit_evaluations[0]?.score : row.fit_evaluations?.score;
  return typeof value === "number" ? value : null;
}

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    type?: string;
    organization?: string;
    fit?: string;
    sort?: string;
    view?: string;
  }>;
}) {
  const params = await searchParams;
  const [{ applications }, needsYouCounts] = await Promise.all([
    loadApplicationsWorkspace(),
    loadNeedsYouFieldCounts(),
  ]);
  const query = (params.q ?? "").trim().toLowerCase();
  const status = (params.status ?? "").trim().toLowerCase();
  const type = (params.type ?? "").trim().toLowerCase();
  const organization = (params.organization ?? "").trim().toLowerCase();
  const fit = (params.fit ?? "").trim().toLowerCase();
  const sort = (params.sort ?? "recent").trim().toLowerCase();
  const view = (params.view ?? "list").trim().toLowerCase() === "board" ? "board" : "list";

  const filtered = applications
    .filter((row) => {
      const opportunity = Array.isArray(row.opportunities) ? row.opportunities[0] : row.opportunities;
      const normalized = normalizeApplicationStatus(row.status);
      const haystack = [opportunity?.title, opportunity?.organization, opportunity?.category, row.next_action]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (status && normalized !== status) return false;
      if (type && String(opportunity?.category ?? "").toLowerCase() !== type) return false;
      if (organization && !(opportunity?.organization ?? "").toLowerCase().includes(organization)) return false;
      const fitScore = numericFit(row);
      if (fit === "high" && (fitScore == null || fitScore < 75)) return false;
      if (fit === "medium" && (fitScore == null || fitScore < 50 || fitScore >= 75)) return false;
      if (fit === "low" && (fitScore == null || fitScore >= 50)) return false;
      return true;
    })
    .slice()
    .sort((a, b) => {
      if (sort === "deadline") {
        return new Date(a.deadline_at ?? "9999-12-31").getTime() - new Date(b.deadline_at ?? "9999-12-31").getTime();
      }
      if (sort === "fit") {
        return (numericFit(b) ?? -1) - (numericFit(a) ?? -1);
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

  const trackerRows = filtered.map((row) =>
    withNeedsYouFieldCount(
      toApplicationsTrackerRow(row),
      needsYouCounts.fieldCountByApplicationId[row.id] ?? 0,
    ),
  );

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Applications"
        title="Track what you actually prepared"
        body="Statuses and snapshots come from your rows. Nothing is seeded for a demo."
        actions={<ButtonLink href="/app/opportunities">New opportunity</ButtonLink>}
      />
      {applications.length === 0 ? (
        <div className="mt-10" data-tour="applications-board">
          <EmptyState
            eyebrow="Empty"
            title="No applications to track"
            body="Create an opportunity first. History stays empty until you do."
          />
        </div>
      ) : (
        <div data-tour="applications-board">
          <Card className="mt-8 p-5">
            <form className="grid gap-4 lg:grid-cols-6">
              <Field label="Search" htmlFor="q">
                <Input id="q" name="q" defaultValue={params.q ?? ""} placeholder="Role, organization, next action" />
              </Field>
              <Field label="Status" htmlFor="status">
                <Select id="status" name="status" defaultValue={params.status ?? ""}>
                  <option value="">All</option>
                  {[
                    "saved",
                    "analyzing",
                    "ready_to_apply",
                    "in_progress",
                    "review_required",
                    "submitted",
                    "under_review",
                    "interview",
                    "accepted",
                    "rejected",
                  ].map((value) => (
                    <option key={value} value={value}>
                      {applicationStatusLabel(value as never)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Type" htmlFor="type">
                <Select id="type" name="type" defaultValue={params.type ?? ""}>
                  <option value="">All types</option>
                  {opportunityCategorySchema.options.map((value) => (
                    <option key={value} value={value}>
                      {value.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Organization" htmlFor="organization">
                <Input
                  id="organization"
                  name="organization"
                  defaultValue={params.organization ?? ""}
                  placeholder="Host name"
                />
              </Field>
              <Field label="Fit" htmlFor="fit">
                <Select id="fit" name="fit" defaultValue={params.fit ?? ""}>
                  <option value="">Any</option>
                  <option value="high">High 75+</option>
                  <option value="medium">Medium 50-74</option>
                  <option value="low">Low under 50</option>
                </Select>
              </Field>
              <Field label="Sort" htmlFor="sort">
                <Select id="sort" name="sort" defaultValue={params.sort ?? "recent"}>
                  <option value="recent">Recent activity</option>
                  <option value="deadline">Nearest deadline</option>
                  <option value="fit">Highest fit</option>
                </Select>
              </Field>
              <Field label="View" htmlFor="view">
                <Select id="view" name="view" defaultValue={view}>
                  <option value="list">List</option>
                  <option value="board">Board</option>
                </Select>
              </Field>
              <div className="lg:col-span-6 flex flex-wrap gap-2">
                <SubmitButton>Apply filters</SubmitButton>
                <ButtonLink href="/app/applications" variant="secondary">
                  Reset
                </ButtonLink>
              </div>
            </form>
          </Card>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <StatusPill tone="muted">{filtered.length} results</StatusPill>
            {status ? <StatusPill tone="sand">status: {status.replace(/_/g, " ")}</StatusPill> : null}
            {fit ? <StatusPill tone="teal">fit: {fit}</StatusPill> : null}
            {view === "board" ? <StatusPill tone="mint">board</StatusPill> : null}
          </div>

          {filtered.length === 0 ? (
            <div className="mt-8">
              <EmptyState
                eyebrow="No match"
                title="No applications match these filters"
                body="Try clearing one or more filters to widen the list."
              />
            </div>
          ) : view === "board" ? (
            <div className="mt-8">
              <ApplicationsTrackerBoard rows={trackerRows} />
            </div>
          ) : (
            <div className="mt-8">
              <ApplicationsTrackerTable rows={trackerRows} />
            </div>
          )}
        </div>
      )}
    </WorkspaceMain>
  );
}
