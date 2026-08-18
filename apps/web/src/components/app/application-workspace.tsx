import Link from "next/link";
import { applicationStatusSchema } from "@1apply/contracts";

import { AnswersSection } from "@/components/app/answer-panel";
import { FlashBanner } from "@/components/app/flash-banner";
import {
  EligibilityPanel,
  FitIndexPanel,
  IntelligenceRefresh,
  ResumeMatchPanel,
} from "@/components/app/intelligence-panels";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress, Timeline } from "@/components/ui/data";
import { Field, Select } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import {
  allowedTransitions,
  applicationStatusLabel,
  computeApplicationCompleteness,
  normalizeApplicationStatus,
} from "@/lib/application-workflow";
import { applicationTone, formatDeadline } from "@/components/app/application-summary";
import { attachDocument, markSubmitted, resolveReviewItem, updateApplicationStatus } from "@/server/applications/actions";
import type { loadApplicationWorkspace } from "@/server/workspace/queries";

const spine = [
  { href: "#opportunity", label: "Opportunity" },
  { href: "#fit", label: "Fit" },
  { href: "#resumes", label: "Resume" },
  { href: "#documents", label: "Documents" },
  { href: "#answers", label: "Questions" },
  { href: "#autofill", label: "Autofill" },
  { href: "#submission", label: "Submission" },
  { href: "#tracking", label: "Tracking" },
] as const;

type Workspace = NonNullable<Awaited<ReturnType<typeof loadApplicationWorkspace>>>;
type CurrentAnswer = NonNullable<Workspace["questions"][number]["answer"]>;

function fmtDateTime(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function coerceAnswer(answer: CurrentAnswer, applicationId: string) {
  return {
    id: String(answer.id ?? ""),
    applicationId,
    questionId: String(answer.question_id ?? ""),
    state: String(answer.state ?? "ai_generated"),
    originalAiText: (answer.original_ai_text as string | null) ?? null,
    userEditedText: (answer.user_edited_text as string | null) ?? null,
    approvedText: (answer.approved_text as string | null) ?? null,
    evidenceIds: (answer.evidence_ids as string[]) ?? [],
    claimFlags:
      (answer.claim_flags as { claim: string; supported: boolean; evidenceId: string | null; reason: string }[]) ?? [],
    missingFacts: (answer.missing_facts as string[]) ?? [],
    warnings: (answer.warnings as string[]) ?? [],
    groundingScore: Number(answer.grounding_score ?? 0),
    generationCount: Number(answer.generation_count ?? 0),
  };
}

export function ApplicationWorkspace({ data, notice, error }: { data: Workspace; notice?: string; error?: string }) {
  const { application, opportunity, questions, documents, attached, snapshots } = data;
  const normalizedStatus = normalizeApplicationStatus(application.status);
  const statusOptions = [normalizedStatus, ...allowedTransitions(application.status)].filter(
    (value, index, list) => list.indexOf(value) === index && applicationStatusSchema.options.includes(value),
  );

  const approvedAnswers = questions.filter((question) => {
    const answer = question.answer;
    return answer && (String(answer.state) === "approved" || Boolean(answer.approved_text));
  }).length;
  const unresolvedReviewItems = data.reviewItems.filter((item) => !item.resolved);
  const fitMissing = Array.isArray(data.fit?.missing) ? (data.fit?.missing as string[]) : [];
  const requiredDocumentLabels = (data.requiredDocuments ?? [])
    .filter((item) => Boolean(item.required))
    .map((item) => String(item.label));
  const attachedDocumentLabels = attached
    .map((item) => documents.find((document) => document.id === item.document_id)?.label ?? null)
    .filter((item): item is string => Boolean(item));
  const recommendedResume = data.resumeMatches.find((item) => item.recommended) ?? data.resumeMatches[0] ?? null;
  const recommendedResumeAttached = recommendedResume
    ? attached.some(
        (item) =>
          item.document_id === recommendedResume.document_id &&
          item.document_version_id === recommendedResume.document_version_id,
      )
    : true;
  const mappingReviewCount = data.fieldMappings.filter(
    (item) => Number(item.confidence ?? 0) < 0.75 || Boolean(item.excluded_by_default),
  ).length;
  const completeness = computeApplicationCompleteness({
    requiredQuestions: questions.filter((item) => item.required).length,
    approvedAnswers,
    requiredDocuments: requiredDocumentLabels,
    attachedDocumentLabels,
    eligibilityNeedsReview: unresolvedReviewItems.map((item) => item.prompt).slice(0, 3),
    missingFitItems: fitMissing,
    recommendedResumeSelected: recommendedResumeAttached,
    fieldMappingsPending: mappingReviewCount,
  });
  const submitted = normalizedStatus === "submitted" || snapshots.length > 0;

  const timelineItems = [
    ...data.statusHistory.map((item) => ({
      id: `status-${item.id}`,
      title: `Status changed to ${applicationStatusLabel(String(item.to_status) as typeof application.status)}`,
      body: item.from_status ? `From ${applicationStatusLabel(String(item.from_status) as typeof application.status)}` : "Workspace created",
      at: fmtDateTime(String(item.created_at)),
      rawAt: String(item.created_at),
    })),
    ...data.events.map((item) => ({
      id: `event-${item.id}`,
      title: String(item.event_name).replace(/\./g, " "),
      body: Object.keys((item.payload as Record<string, unknown>) ?? {}).length
        ? JSON.stringify(item.payload)
        : undefined,
      at: fmtDateTime(String(item.created_at)),
      rawAt: String(item.created_at),
    })),
    ...snapshots.map((snapshot) => ({
      id: `snapshot-${snapshot.id}`,
      title: "Immutable submission snapshot frozen",
      body: `${((snapshot.answer_manifest ?? []) as unknown[]).length} answers · ${((snapshot.document_manifest ?? []) as unknown[]).length} documents`,
      at: fmtDateTime(String(snapshot.submitted_at)),
      rawAt: String(snapshot.submitted_at),
    })),
  ].sort((a, b) => new Date(a.rawAt).getTime() - new Date(b.rawAt).getTime());

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Application workspace"
        title={opportunity?.title ?? "Untitled opportunity"}
        body={`${opportunity?.organization ?? "Unknown host"} · ${formatDeadline(application.deadline_at)} · This workspace manages evidence, drafts, and history. It never submits for you.`}
        actions={<StatusPill tone={applicationTone(application.status)}>{applicationStatusLabel(application.status)}</StatusPill>}
      />
      <FlashBanner notice={notice} error={error} />

      <nav className="mt-8 flex flex-wrap gap-2" aria-label="Workspace steps">
        {spine.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink-muted hover:border-ink/40 hover:text-ink"
          >
            {item.label}
          </a>
        ))}
      </nav>

      <section id="opportunity" className="mt-10 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.9fr)]">
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl">Opportunity</h2>
              <p className="mt-2 text-sm text-ink-muted">
                Source: {opportunity?.source ?? "unknown"}
                {opportunity?.source_url ? (
                  <>
                    {" "}
                    ·{" "}
                    <a className="underline" href={opportunity.source_url} rel="noreferrer" target="_blank">
                      Original page
                    </a>
                  </>
                ) : null}
              </p>
            </div>
            <IntelligenceRefresh applicationId={application.id} />
          </div>
          <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Organization</dt>
              <dd className="mt-1">{opportunity?.organization ?? "Unknown host"}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Type</dt>
              <dd className="mt-1">{opportunity?.category?.replace(/_/g, " ") ?? "Unknown"}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Deadline</dt>
              <dd className="mt-1">{formatDeadline(application.deadline_at)}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Location</dt>
              <dd className="mt-1">{opportunity?.location ?? "Not specified"}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Lifecycle</dt>
              <dd className="mt-1">{applicationStatusLabel(application.status)}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Next action</dt>
              <dd className="mt-1">{application.next_action ?? "Analyze this opportunity"}</dd>
            </div>
          </dl>
          {opportunity?.raw_excerpt ? (
            <p className="mt-6 max-h-40 overflow-auto rounded-xl bg-canvas p-4 text-sm leading-6 text-ink-muted">
              {opportunity.raw_excerpt.slice(0, 1200)}
            </p>
          ) : null}
        </Card>

        <Card className="p-6">
          <h2 className="font-display text-2xl">Submission readiness</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Deterministic completeness from required documents, approved answers, review items, Fit gaps, and autofill review.
          </p>
          <div className="mt-6">
            <Progress value={completeness.percent} label={`${completeness.complete} / ${completeness.total} required complete`} />
            <p className="mt-3 font-mono text-3xl">{completeness.percent}%</p>
          </div>
          {completeness.remaining.length > 0 ? (
            <div className="mt-5 rounded-xl border border-line bg-canvas p-4">
              <p className="font-medium">Remaining</p>
              <ul className="mt-3 grid gap-2 text-sm text-ink-muted">
                {completeness.remaining.slice(0, 8).map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              All required items are complete. You can freeze a submission snapshot when you are ready.
            </p>
          )}
        </Card>
      </section>

      <EligibilityPanel data={data} />
      <FitIndexPanel data={data} />
      <ResumeMatchPanel data={data} />

      <section id="documents" className="mt-8 scroll-mt-8">
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl">Documents</h2>
              <p className="mt-2 text-sm text-ink-muted">Required documents, your selected documents, and exact versions stay explicit.</p>
            </div>
            <StatusPill tone="muted">
              {attached.length} selected / {requiredDocumentLabels.length || 0} required
            </StatusPill>
          </div>
          {requiredDocumentLabels.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {requiredDocumentLabels.map((label) => {
                const complete = attachedDocumentLabels.some((item) => item.toLowerCase() === label.toLowerCase());
                return (
                  <StatusPill key={label} tone={complete ? "mint" : "sand"}>
                    {label}
                  </StatusPill>
                );
              })}
            </div>
          ) : null}
          {documents.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">
              <Link className="underline" href="/app/documents">
                Upload a document
              </Link>{" "}
              first.
            </p>
          ) : (
            <ul className="mt-6 grid gap-3">
              {documents.map((document) => {
                const attachment = attached.find((item) => item.document_id === document.id);
                const versions = document.document_versions ?? [];
                const defaultVersionId = document.current_version_id ?? versions[0]?.id ?? "";
                return (
                  <li key={document.id} className="rounded-xl border border-line p-4 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{document.label}</p>
                        <p className="mt-1 text-ink-muted">
                          {document.type.replace(/_/g, " ")}
                          {attachment ? ` · selected ${versions.find((v) => v.id === attachment.document_version_id)?.version_label ?? ""}` : ""}
                        </p>
                        <Link href={`/app/documents/${document.id}`} className="mt-1 inline-block text-teal underline">
                          View version history
                        </Link>
                      </div>
                    </div>
                    <form action={attachDocument} className="mt-3 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="applicationId" value={application.id} />
                      <input type="hidden" name="documentId" value={document.id} />
                      <Field label="Version to attach" htmlFor={`version-${document.id}`}>
                        <Select id={`version-${document.id}`} name="versionId" defaultValue={attachment?.document_version_id ?? defaultVersionId}>
                          {versions.map((version) => (
                            <option key={version.id} value={version.id}>
                              {version.version_label}
                              {document.current_version_id === version.id ? " (latest)" : ""}
                              {version.original_filename ? ` · ${version.original_filename}` : ""}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Button type="submit" variant="secondary">
                        {attachment ? "Update selection" : "Select version"}
                      </Button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      <section id="answers" className="mt-8 scroll-mt-8">
        <div className="mb-4 flex items-baseline justify-between">
          <div>
            <h2 className="font-display text-2xl">Questions and answers</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Extracted questions, grounded drafts, evidence traces, and explicit approval states.
            </p>
          </div>
          <StatusPill tone={approvedAnswers >= questions.filter((item) => item.required).length ? "mint" : "sand"}>
            {approvedAnswers} approved
          </StatusPill>
        </div>
        <AnswersSection
          applicationId={application.id}
          questions={questions}
          answers={questions
            .map((q) => q.answer)
            .filter((a): a is CurrentAnswer => a != null)
            .map((a) => coerceAnswer(a, application.id))}
          availableEvidence={data.evidence.map((e) => ({
            id: e.id,
            title: e.title,
            kind: e.kind,
            organization: e.organization,
            situation: e.situation,
            action: e.action,
            outcome: e.outcome,
            skills: e.skills,
          }))}
        />
      </section>

      <section id="autofill" className="mt-8 scroll-mt-8">
        <Card className="p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl">Autofill</h2>
              <p className="mt-2 text-sm text-ink-muted">Field mappings, confidence, and preview stay visible before any controlled browser fill.</p>
            </div>
            <StatusPill tone={mappingReviewCount > 0 ? "sand" : "mint"}>
              {data.fieldMappings.length} mapped fields
            </StatusPill>
          </div>
          {data.fieldMappings.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">No field mappings recorded yet. Autofill remains opt-in and preview-first.</p>
          ) : (
            <ul className="mt-6 grid gap-3">
              {data.fieldMappings.slice(0, 8).map((item) => (
                <li key={item.id} className="rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{item.label}</p>
                      <p className="mt-1 text-sm text-ink-muted">{item.value || "Empty value"}</p>
                      <p className="mt-1 text-xs text-ink-muted">Source: {item.source} · Key: {item.field_key}</p>
                    </div>
                    <StatusPill tone={Number(item.confidence) >= 0.75 ? "mint" : "sand"}>
                      {Math.round(Number(item.confidence) * 100)}% confidence
                    </StatusPill>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section id="submission" className="mt-8 scroll-mt-8">
        <Card className="p-6">
          <h2 className="font-display text-2xl">Submission</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Freeze an immutable snapshot of opportunity, selected versions, final answers, and referenced evidence. This does not submit to the host.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <form action={markSubmitted}>
              <input type="hidden" name="applicationId" value={application.id} />
              <Button type="submit" disabled={submitted || !completeness.readyForSubmission}>
                {submitted ? "Snapshot already frozen" : "Freeze submission snapshot"}
              </Button>
            </form>
            <form action={updateApplicationStatus} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="applicationId" value={application.id} />
              <Field label="Status" htmlFor={`status-${application.id}`}>
                <Select id={`status-${application.id}`} name="status" defaultValue={normalizedStatus}>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {applicationStatusLabel(status)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" variant="secondary">
                Update status
              </Button>
            </form>
          </div>
          {snapshots.length > 0 ? (
            <div className="mt-6 rounded-xl bg-canvas p-4 text-sm">
              <p className="font-medium">Historical snapshots</p>
              <ul className="mt-3 grid gap-2">
                {snapshots.slice(0, 3).map((snapshot) => (
                  <li key={snapshot.id} className="rounded-lg border border-line/60 px-3 py-2">
                    <p>{fmtDateTime(String(snapshot.submitted_at))}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {((snapshot.document_manifest ?? []) as unknown[]).length} documents · {((snapshot.answer_manifest ?? []) as unknown[]).length} answers · status {String(snapshot.application_status ?? "submitted").replace(/_/g, " ")}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </section>

      <section id="tracking" className="mt-8 scroll-mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <Card className="p-6">
          <h2 className="font-display text-2xl">Timeline</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Opportunity saved → analyzed → fit calculated → resume selected → answers generated → answers approved → autofill → submitted → interview → outcome.
          </p>
          <div className="mt-6">
            <Timeline items={timelineItems} />
          </div>
        </Card>

        <div className="grid gap-6">
          <Card className="p-6">
            <h2 className="font-display text-2xl">Review and follow-ups</h2>
            <ul className="mt-4 grid gap-2">
              {unresolvedReviewItems.length === 0 ? (
                <li className="text-sm text-ink-muted">No open review items.</li>
              ) : (
                unresolvedReviewItems.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3 text-sm">
                    <span>{item.prompt}</span>
                    <form action={resolveReviewItem}>
                      <input type="hidden" name="applicationId" value={application.id} />
                      <input type="hidden" name="itemId" value={item.id} />
                      <Button type="submit" variant="ghost">
                        Resolve
                      </Button>
                    </form>
                  </li>
                ))
              )}
            </ul>
          </Card>

          <Card className="p-6">
            <h2 className="font-display text-2xl">Tracking</h2>
            <dl className="mt-4 grid gap-4 text-sm">
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Current status</dt>
                <dd className="mt-1">{applicationStatusLabel(application.status)}</dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Submitted at</dt>
                <dd className="mt-1">{application.submitted_at ? fmtDateTime(application.submitted_at) : "Not recorded"}</dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Latest follow-up</dt>
                <dd className="mt-1">{timelineItems[timelineItems.length - 1]?.title ?? "No activity yet"}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </section>
    </WorkspaceMain>
  );
}
