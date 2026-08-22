import {
  computeDeadlineInfo,
  evaluateSubmissionGuard,
  assessOperatingLoop,
  PERSONA_PRESETS,
  type SubmissionInput,
} from "@1apply/domain";
import { applicationStatusSchema } from "@1apply/contracts";
import Link from "next/link";

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
import { Field, Input, Select } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import {
  allowedTransitions,
  applicationStatusLabel,
  computeApplicationCompleteness,
  normalizeApplicationStatus,
} from "@/lib/application-workflow";
import { applicationTone, formatDeadline } from "@/components/app/application-summary";
import {
  attachDocument,
  deleteApplication,
  markSubmitted,
  resolveReviewItem,
  updateApplicationPersona,
  updateApplicationSchedule,
  updateApplicationStatus,
} from "@/server/applications/actions";
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

function toDatetimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
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
  const loop = assessOperatingLoop({
    hasOpportunity: Boolean(opportunity),
    opportunityAnalyzed: opportunity?.analysis_status === "ready" || (data.eligibility?.length ?? 0) > 0,
    hasEligibility: (data.eligibility?.length ?? 0) > 0,
    hasFit: Boolean(data.fit),
    hasResumeMatch: data.resumeMatches.length > 0,
    hasGeneratedAnswer: questions.some((question) => Boolean(question.answer)),
    hasApprovedAnswer: approvedAnswers > 0,
    hasAutofillMapping: data.fieldMappings.length > 0,
    hasSubmissionSnapshot: snapshots.length > 0,
    hasTrackingEvent: data.events.length > 0 || data.statusHistory.length > 0,
    hasEmailEvent: (data.emailEvents?.length ?? 0) > 0,
    hasCalendarEvent: (data.calendarEvents?.length ?? 0) > 0,
    hasVerifiedMemory: (data.evidence ?? []).some(
      (item) => item.verificationStatus === "verified" && !item.excludedFromAi,
    ),
    hasNextApplication: false,
  });

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

      <ol className="mt-6 flex flex-wrap gap-2" aria-label="Application operating loop">
        {loop.map((stage) => (
          <li
            key={stage.id}
            title={stage.detail}
            className={`rounded-full border px-2.5 py-1 text-[11px] ${stage.done ? "border-teal/30 bg-mint-soft text-teal" : "border-line bg-white text-ink-muted"}`}
          >
            {stage.label}
          </li>
        ))}
      </ol>

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
          <form action={updateApplicationSchedule} className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <input type="hidden" name="applicationId" value={application.id} />
            <Field label="Deadline" htmlFor={`deadline-${application.id}`}>
              <Input
                id={`deadline-${application.id}`}
                name="deadline"
                type="datetime-local"
                defaultValue={toDatetimeLocal(application.deadline_at)}
              />
            </Field>
            <Field label="Timezone" htmlFor={`timezone-${application.id}`} hint="IANA name, for example Asia/Karachi">
              <Input
                id={`timezone-${application.id}`}
                name="timezone"
                defaultValue={application.deadline_timezone ?? ""}
                placeholder="Asia/Karachi"
              />
            </Field>
            <Button type="submit" variant="secondary">
              Save schedule
            </Button>
          </form>
          <form action={updateApplicationPersona} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <input type="hidden" name="applicationId" value={application.id} />
            <Field label="Answer voice" htmlFor={`persona-${application.id}`}>
              <Select id={`persona-${application.id}`} name="persona" defaultValue={application.persona ?? ""}>
                <option value="">Default evidence ranking</option>
                {PERSONA_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} — {preset.description}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="secondary">
              Save voice
            </Button>
          </form>
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
          previousAnswers={data.previousAnswers}
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
            <p className="mt-4 text-sm text-ink-muted">
              No field mappings yet. Open the Chrome extension on the host form and use Fill from memory. Suggestions
              write into fields automatically; chips appear when alternates exist. 1-Apply never clicks submit.
            </p>
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
          <DeadlineDisplay deadlineAt={application.deadline_at} />
          <SubmissionChecklist data={data} />
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

          <Card className="border-coral/20 p-6">
            <h2 className="font-display text-2xl text-coral">Danger Zone</h2>
            <p className="mt-2 text-sm text-ink-muted">
              Permanently delete this application and its prepared answers, mappings, and evaluations.
            </p>
            <form action={deleteApplication} className="mt-4">
              <input type="hidden" name="applicationId" value={application.id} />
              <Button type="submit" variant="secondary" className="border-coral/30 text-coral hover:bg-coral-soft">
                Delete application
              </Button>
            </form>
          </Card>
        </div>
      </section>
      <ApplicationTimeline
        emailEvents={data.emailEvents ?? []}
        calendarEvents={data.calendarEvents ?? []}
        submittedAt={application.submitted_at}
      />
    </WorkspaceMain>
  );
}

const EMAIL_KIND_LABELS: Record<string, string> = {
  application_received: "Application received",
  interview_invitation: "Interview invitation",
  assessment: "Assessment",
  rejection: "Rejection",
  offer: "Offer",
  follow_up_request: "Follow-up request",
};

function ApplicationTimeline({
  emailEvents,
  calendarEvents,
  submittedAt,
}: {
  emailEvents: Array<{
    id: string;
    event_kind: string;
    subject: string | null;
    sender_domain: string | null;
    occurred_at: string;
    interview_detected: boolean;
    confirmed?: boolean;
  }>;
  calendarEvents: Array<{
    id: string;
    title: string;
    starts_at: string;
    confirmed: boolean;
    location: string | null;
    meeting_url: string | null;
  }>;
  submittedAt: string | null;
}) {
  const events: Array<{
    date: string;
    kind: string;
    label: string;
    detail: string;
    tone: "mint" | "coral" | "sand" | "muted";
  }> = [];

  if (submittedAt) {
    events.push({
      date: submittedAt,
      kind: "submitted",
      label: "Submitted",
      detail: "Application snapshot frozen.",
      tone: "mint",
    });
  }
  for (const e of emailEvents) {
    events.push({
      date: e.occurred_at,
      kind: e.event_kind,
      label: EMAIL_KIND_LABELS[e.event_kind] ?? e.event_kind,
      detail: [e.sender_domain ?? "", e.subject ? `"${e.subject.slice(0, 80)}"` : ""].filter(Boolean).join(" · "),
      tone:
        e.event_kind === "rejection"
          ? "coral"
          : e.event_kind === "offer" || e.event_kind === "interview_invitation"
            ? "mint"
            : "sand",
    });
  }
  for (const c of calendarEvents) {
    events.push({
      date: c.starts_at,
      kind: c.confirmed ? "interview_scheduled" : "interview_pending",
      label: c.confirmed ? "Interview scheduled" : "Interview (pending confirmation)",
      detail: [c.title, c.location, c.meeting_url].filter(Boolean).join(" · ").slice(0, 120),
      tone: c.confirmed ? "mint" : "sand",
    });
  }

  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (events.length === 0) return null;

  return (
    <section className="mt-10">
      <Card>
        <h2 className="text-base font-semibold">Email and calendar timeline</h2>
        <ol className="mt-4 space-y-4">
          {events.map((ev, i) => (
            <li key={`${ev.kind}-${ev.date}-${i}`} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`mt-1 h-3 w-3 rounded-full ${ev.tone === "mint" ? "bg-mint" : ev.tone === "coral" ? "bg-coral" : ev.tone === "sand" ? "bg-sand" : "bg-ink-muted/30"}`}
                />
                {i < events.length - 1 ? <div className="mt-1 h-full w-px bg-line" /> : null}
              </div>
              <div className="pb-4">
                <p className="text-sm font-medium">{ev.label}</p>
                <p className="text-xs text-ink-muted">{fmtDateTime(ev.date)}</p>
                {ev.detail ? <p className="mt-0.5 text-xs text-ink-muted">{ev.detail}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}

function DeadlineDisplay({ deadlineAt }: { deadlineAt: string | null }) {
  if (!deadlineAt) return null;
  const info = computeDeadlineInfo(deadlineAt, null);
  const tones: Record<string, string> = {
    overdue: "bg-coral-soft text-coral border-coral/20",
    imminent: "bg-coral-soft text-coral border-coral/20",
    soon: "bg-sand-soft text-sand border-sand/20",
    upcoming: "bg-mint-soft text-teal border-teal/20",
    none: "bg-canvas text-ink-muted border-line",
  };
  return (
    <div className={`mt-4 rounded-xl border p-3 text-sm ${tones[info.urgency] ?? tones.none}`}>
      <p className="font-medium">{info.label}</p>
      {info.hoursRemaining !== null && info.hoursRemaining > 0 ? (
        <p className="mt-1 text-xs">
          {info.hoursRemaining < 24
            ? `${Math.round(info.hoursRemaining)} hours remaining`
            : `${Math.round(info.hoursRemaining / 24)} days remaining`}
        </p>
      ) : null}
    </div>
  );
}

function SubmissionChecklist({ data }: { data: Workspace }) {
  const { application, questions, eligibility, fit, attached, snapshots, reviewItems, resumeMatches } = data;
  const approved = questions.filter((q) => q.answer && (String(q.answer.state) === "approved" || Boolean(q.answer.approved_text)));
  const recommended = resumeMatches.find((r) => (r as { recommended?: boolean }).recommended);

  const guardInput: SubmissionInput = {
    applicationId: application.id,
    status: application.status,
    questions: questions.map((q) => ({ id: q.id, prompt: q.prompt })),
    approvedAnswerIds: new Map(
      approved.map((q) => [q.id, String(q.answer?.id ?? "")]),
    ),
    attachedDocumentIds: attached.map((a) => a.document_id as string),
    resumeMatchRecommended: recommended ? (recommended.document_id as string) : null,
    eligibilityResults: eligibility.map((e) => ({
      state: e.state as string,
      explanation: e.explanation as string,
    })),
    reviewItems: reviewItems.map((r) => ({
      resolved: r.resolved as boolean,
      prompt: r.prompt as string,
    })),
    snapshots: snapshots.map((s) => ({ id: s.id as string })),
    fitScore: (fit?.score as number | null) ?? null,
    fitMissing: (fit?.missing as string[]) ?? [],
    hasSignatureField: false,
    hasPaymentField: false,
    hasCaptcha: false,
    hasSecurityChallenge: false,
    userAuthenticated: true,
  };

  const guard = evaluateSubmissionGuard(guardInput);

  return (
    <div className="mt-4 rounded-xl border border-line bg-white p-4">
      <h3 className="text-sm font-medium">
        Submission checklist — {guard.safe ? "Ready" : `${guard.blockers.length} blocker(s)`}
      </h3>
      <ul className="mt-3 grid gap-1.5">
        {guard.checks.map((check) => (
          <li key={check.kind} className="flex items-start gap-2 text-sm">
            <span
              className={`mt-0.5 inline-block h-4 w-4 flex-shrink-0 rounded-full text-center text-[10px] font-bold leading-4 ${check.passed ? "bg-mint text-teal" : check.blocking ? "bg-coral-soft text-coral" : "bg-sand-soft text-sand"}`}
            >
              {check.passed ? "\u2713" : check.blocking ? "\u2717" : "!"}
            </span>
            <span>
              <span className="font-medium">{check.label}</span>
              <span className="text-ink-muted"> — {check.reason}</span>
            </span>
          </li>
        ))}
      </ul>
      {guard.warnings.length > 0 ? (
        <p className="mt-3 text-xs text-ink-muted">
          {guard.warnings.length} warning(s) — review before submitting, but these will not block the snapshot.
        </p>
      ) : null}
    </div>
  );
}
