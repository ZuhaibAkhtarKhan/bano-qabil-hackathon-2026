import Link from "next/link";
import { applicationStatusSchema } from "@1apply/contracts";
import {
  computeDeadlineInfo,
  evaluateSubmissionGuard,
  type SubmissionInput,
} from "@1apply/domain";

import { FlashBanner } from "@/components/app/flash-banner";
import { EligibilityPanel } from "@/components/app/intelligence/eligibility-panel";
import { FitIndexPanel } from "@/components/app/intelligence/fit-index-panel";
import { ResumeMatchPanel } from "@/components/app/intelligence/resume-match-panel";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SemanticBadge, StatusPill } from "@/components/ui/status-pill";
import {
  addQuestion,
  analyzeApplication,
  approveAnswer,
  attachDocument,
  generateAnswer,
  markSubmitted,
  resolveReviewItem,
  saveManualAnswer,
  updateApplicationStatus,
} from "@/server/applications/actions";
import { applicationTone, formatDeadline } from "@/components/app/application-summary";
import { answerSemanticStatus } from "@/lib/status";
import type { loadApplicationWorkspace } from "@/server/workspace/queries";

const spine = [
  { href: "#analyze", label: "Analyze" },
  { href: "#eligibility", label: "Eligibility" },
  { href: "#fit", label: "Fit Index" },
  { href: "#resumes", label: "Resumes" },
  { href: "#answers", label: "Answers" },
  { href: "#documents", label: "Documents" },
  { href: "#review", label: "Review" },
] as const;

type Workspace = NonNullable<Awaited<ReturnType<typeof loadApplicationWorkspace>>>;

export function ApplicationWorkspace({
  data,
  notice,
  error,
}: {
  data: Workspace;
  notice?: string;
  error?: string;
}) {
  const { application, opportunity, questions, eligibility, fit, evidenceRows, documents, attached, snapshots, requirements } = data;
  const verified = evidenceRows.filter((item) => item.verification_status === "verified" && !item.excluded_from_ai);
  const submitted = application.status === "submitted" || snapshots.length > 0;

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Application workspace"
        title={opportunity?.title ?? "Untitled opportunity"}
        body={`${opportunity?.organization ?? "Unknown host"} · ${formatDeadline(application.deadline_at)} · 1-Apply never submits for you.`}
        actions={<StatusPill tone={applicationTone(application.status)}>{application.status.replace("_", " ")}</StatusPill>}
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

      <section id="analyze" className="mt-10 scroll-mt-8">
        <Card className="p-6">
        <h2 className="font-display text-2xl">Analyze</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Source: {opportunity?.source}
          {opportunity?.source_url ? (
            <>
              {" "}
              ·{" "}
              <a className="underline" href={opportunity.source_url} rel="noreferrer" target="_blank">
                Original page
              </a>
            </>
          ) : null}
          . Page text is untrusted data.
        </p>
        {opportunity?.raw_excerpt ? (
          <p className="mt-4 max-h-40 overflow-auto rounded-xl bg-canvas p-4 text-sm leading-6 text-ink-muted">
            {opportunity.raw_excerpt.slice(0, 1200)}
          </p>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">No page excerpt stored. Add requirements and questions below.</p>
        )}
        <form action={analyzeApplication} className="mt-5">
          <input type="hidden" name="applicationId" value={application.id} />
          <Button type="submit">Refresh eligibility and Fit Index</Button>
        </form>
        </Card>
      </section>

      <div className="mt-8 grid gap-8">
        <EligibilityPanel applicationId={application.id} eligibility={eligibility} requirements={requirements} />
        <FitIndexPanel fit={fit} />
        <ResumeMatchPanel matches={data.resumeMatches} documents={documents} />
      </div>

      <section id="answers" className="mt-8 scroll-mt-8">
        <Card className="p-6">
        <h2 className="font-display text-2xl">Answers</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Drafts must cite verified evidence. Empty evidence produces no fluent claim.
        </p>
        <form action={addQuestion} className="mt-6 grid gap-3">
          <input type="hidden" name="applicationId" value={application.id} />
          <Field label="Add question" htmlFor={`question-${application.id}`}>
            <Textarea id={`question-${application.id}`} name="prompt" rows={3} required placeholder="Why are you applying?" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Limit" htmlFor={`limit-${application.id}`}>
              <Input id={`limit-${application.id}`} name="limitValue" type="number" min={0} />
            </Field>
            <Field label="Unit" htmlFor={`unit-${application.id}`}>
              <Input id={`unit-${application.id}`} name="limitUnit" placeholder="words or characters" />
            </Field>
          </div>
          <Button type="submit" variant="secondary">
            Add question
          </Button>
        </form>
        <div className="mt-8 grid gap-6">
          {questions.length === 0 ? (
            <EmptyState
              eyebrow="Empty"
              title="No questions yet"
              body="Add a prompt from the posting. Generation stays silent until verified evidence exists."
            />
          ) : (
            questions.map((question) => {
              const latest = question.versions[0];
              const shown = question.approved ?? latest;
              const status = answerSemanticStatus({
                approved: Boolean(question.approved),
                model: shown?.model ?? null,
                text: shown?.text ?? "",
              });
              return (
              <article key={question.id} className="rounded-2xl border border-line p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="text-base font-medium">{question.prompt}</h3>
                  <SemanticBadge status={status} />
                </div>
                {question.limit_value ? (
                  <p className="mt-1 text-xs text-ink-muted">
                    Limit {question.limit_value} {question.limit_unit ?? "characters"}
                  </p>
                ) : null}
                {question.approved ? (
                  <p className="mt-3 rounded-xl border border-emerald-200 bg-mint-soft p-3 text-sm">{question.approved.text}</p>
                ) : question.versions[0] ? (
                  <p
                    className={
                      status === "ai_generated"
                        ? "mt-3 rounded-xl border border-dashed border-violet-200 bg-violet-soft p-3 text-sm"
                        : "mt-3 rounded-xl border border-cyan-200 bg-teal-soft p-3 text-sm"
                    }
                  >
                    {question.versions[0].text || "No grounded text stored."}
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-ink-muted">No draft yet.</p>
                )}
                {question.versions[0]?.warnings?.length ? (
                  <p className="mt-2 text-xs text-ink-muted">{question.versions[0].warnings.join(" · ")}</p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <form action={generateAnswer}>
                    <input type="hidden" name="applicationId" value={application.id} />
                    <input type="hidden" name="questionId" value={question.id} />
                    <Button type="submit">Generate grounded draft</Button>
                  </form>
                  {question.versions[0] && !question.versions[0].approved ? (
                    <form action={approveAnswer}>
                      <input type="hidden" name="applicationId" value={application.id} />
                      <input type="hidden" name="versionId" value={question.versions[0].id} />
                      <Button type="submit" variant="secondary">
                        Approve latest version
                      </Button>
                    </form>
                  ) : null}
                </div>
                <form action={saveManualAnswer} className="mt-4 grid gap-3">
                  <input type="hidden" name="applicationId" value={application.id} />
                  <input type="hidden" name="questionId" value={question.id} />
                  <Field label="Write or edit from evidence" htmlFor={`answer-${question.id}`}>
                    <Textarea
                      id={`answer-${question.id}`}
                      name="text"
                      rows={5}
                      defaultValue={question.versions[0]?.text ?? ""}
                    />
                  </Field>
                  <fieldset>
                    <legend className="text-xs font-medium text-ink-muted">Cite verified evidence</legend>
                    <ul className="mt-2 grid gap-2">
                      {verified.length === 0 ? (
                        <li className="text-sm text-ink-muted">
                          Verify evidence in{" "}
                          <Link className="underline" href="/app/memory">
                            Application Memory
                          </Link>{" "}
                          first.
                        </li>
                      ) : (
                        verified.map((item) => (
                          <li key={item.id}>
                            <label className="flex items-start gap-2 text-sm">
                              <input type="checkbox" name="evidenceId" value={item.id} className="mt-1" />
                              <span>
                                <strong>{item.title}</strong>
                                {item.organization ? ` · ${item.organization}` : ""}
                              </span>
                            </label>
                          </li>
                        ))
                      )}
                    </ul>
                  </fieldset>
                  <Button type="submit" variant="secondary">
                    Save as new version
                  </Button>
                </form>
              </article>
            );
            })
          )}
        </div>
        </Card>
      </section>

      <section id="documents" className="mt-8 scroll-mt-8">
        <Card className="p-6">
        <h2 className="font-display text-2xl">Documents</h2>
        <p className="mt-2 text-sm text-ink-muted">Attach an exact version. Uploads live in your private vault.</p>
        {documents.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">
            <Link className="underline" href="/app/documents">
              Upload a document
            </Link>{" "}
            first.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {documents.map((document) => {
              const attachment = attached.find((item) => item.document_id === document.id);
              const versions = document.document_versions ?? [];
              const defaultVersionId = document.current_version_id ?? versions[0]?.id ?? "";
              return (
                <li
                  key={document.id}
                  className="rounded-xl border border-line p-4 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{document.label}</p>
                      <p className="mt-1 text-ink-muted">
                        {document.type.replace(/_/g, " ")}
                        {attachment
                          ? ` · attached ${versions.find((v) => v.id === attachment.document_version_id)?.version_label ?? ""}`
                          : ""}
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
                      <Select
                        id={`version-${document.id}`}
                        name="versionId"
                        defaultValue={attachment?.document_version_id ?? defaultVersionId}
                      >
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
                      {attachment ? "Update attachment" : "Attach version"}
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
        </Card>
      </section>

      <section id="review" className="mt-8 scroll-mt-8">
        <Card className="p-6">
        <h2 className="font-display text-2xl">Review and track</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Marking submitted freezes a snapshot. It does not contact the host, fill a form, or send unanswered questions.
        </p>

        <DeadlineDisplay deadlineAt={application.deadline_at} />

        <SubmissionChecklist data={data} />

        <ul className="mt-4 grid gap-2">
          {data.reviewItems.length === 0 ? (
            <li className="text-sm text-ink-muted">No open review items.</li>
          ) : (
            data.reviewItems.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3 text-sm">
                <span className={item.resolved ? "text-ink-muted line-through" : ""}>{item.prompt}</span>
                {!item.resolved ? (
                  <form action={resolveReviewItem}>
                    <input type="hidden" name="applicationId" value={application.id} />
                    <input type="hidden" name="itemId" value={item.id} />
                    <Button type="submit" variant="ghost">
                      Resolve
                    </Button>
                  </form>
                ) : null}
              </li>
            ))
          )}
        </ul>
        {snapshots.length > 0 ? (
          <div className="mt-6 rounded-xl bg-canvas p-4 text-sm">
            <p className="font-medium">Frozen snapshots: {snapshots.length}</p>
            <p className="mt-1 text-ink-muted">
              Latest{" "}
              {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
                new Date(snapshots[0]!.submitted_at),
              )}
              . Snapshots cannot be edited — they record exact answer and document versions.
            </p>
            <ul className="mt-3 grid gap-2">
              {snapshots.slice(0, 3).map((snapshot) => {
                const manifest = (snapshot.document_manifest ?? []) as Array<{
                  documentId: string;
                  documentVersionId: string;
                }>;
                const guardData = snapshot.guard_result as { checks?: Array<{ passed: boolean }> } | null;
                const passedCount = guardData?.checks?.filter((c) => c.passed).length ?? 0;
                const totalCount = guardData?.checks?.length ?? 0;
                return (
                  <li key={snapshot.id} className="rounded-lg border border-line/60 px-3 py-2">
                    <p>
                      {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
                        new Date(snapshot.submitted_at),
                      )}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {manifest.length} document version{manifest.length === 1 ? "" : "s"} frozen ·{" "}
                      {((snapshot.answer_manifest ?? []) as unknown[]).length} approved answer
                      {((snapshot.answer_manifest ?? []) as unknown[]).length === 1 ? "" : "s"}
                      {totalCount > 0 ? ` · Guard: ${passedCount}/${totalCount} checks passed` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <form action={markSubmitted}>
            <input type="hidden" name="applicationId" value={application.id} />
            <Button type="submit" disabled={submitted}>
              {submitted ? "Snapshot already frozen" : "Mark submitted and freeze snapshot"}
            </Button>
          </form>
          <form action={updateApplicationStatus} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="applicationId" value={application.id} />
            <Field label="Status" htmlFor={`status-${application.id}`}>
              <Select id={`status-${application.id}`} name="status" defaultValue={application.status}>
                {applicationStatusSchema.options.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="secondary">
              Update status
            </Button>
          </form>
        </div>
        </Card>
      </section>

      {/* ── Application timeline ───────────────────────────────── */}
      <ApplicationTimeline emailEvents={data.emailEvents ?? []} calendarEvents={data.calendarEvents ?? []} submittedAt={application.submitted_at} />
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
  emailEvents: Array<{ id: string; event_kind: string; subject: string | null; sender_domain: string | null; occurred_at: string; interview_detected: boolean; confirmed?: boolean }>;
  calendarEvents: Array<{ id: string; title: string; starts_at: string; confirmed: boolean; location: string | null; meeting_url: string | null }>;
  submittedAt: string | null;
}) {
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  const events: Array<{ date: string; kind: string; label: string; detail: string; tone: "mint" | "coral" | "sand" | "muted" }> = [];

  if (submittedAt) {
    events.push({ date: submittedAt, kind: "submitted", label: "Submitted", detail: "Application snapshot frozen.", tone: "mint" });
  }
  for (const e of emailEvents) {
    events.push({
      date: e.occurred_at,
      kind: e.event_kind,
      label: EMAIL_KIND_LABELS[e.event_kind] ?? e.event_kind,
      detail: [e.sender_domain ?? "", e.subject ? `"${e.subject.slice(0, 80)}"` : ""].filter(Boolean).join(" · "),
      tone: e.event_kind === "rejection" ? "coral" : e.event_kind === "offer" || e.event_kind === "interview_invitation" ? "mint" : "sand",
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
        <h2 className="text-base font-semibold">Application timeline</h2>
        <ol className="mt-4 space-y-4">
          {events.map((ev, i) => (
            <li key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`h-3 w-3 rounded-full mt-1 ${ev.tone === "mint" ? "bg-mint" : ev.tone === "coral" ? "bg-coral" : ev.tone === "sand" ? "bg-sand" : "bg-ink-muted/30"}`}
                />
                {i < events.length - 1 && <div className="mt-1 h-full w-px bg-line" />}
              </div>
              <div className="pb-4">
                <p className="text-sm font-medium">{ev.label}</p>
                <p className="text-xs text-ink-muted">{fmt(ev.date)}</p>
                {ev.detail && <p className="mt-0.5 text-xs text-ink-muted">{ev.detail}</p>}
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
  const approved = questions.filter((q) => q.approved);
  const recommended = resumeMatches.find((r) => (r as { recommended?: boolean }).recommended);

  const guardInput: SubmissionInput = {
    applicationId: application.id,
    status: application.status,
    questions: questions.map((q) => ({ id: q.id, prompt: q.prompt })),
    approvedAnswerIds: new Map(approved.map((q) => [q.id, q.approved!.id])),
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
    fitScore: fit?.score as number | null ?? null,
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
            <span className={`mt-0.5 inline-block h-4 w-4 flex-shrink-0 rounded-full text-center text-[10px] leading-4 font-bold ${check.passed ? "bg-mint text-teal" : check.blocking ? "bg-coral-soft text-coral" : "bg-sand-soft text-sand"}`}>
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
          {guard.warnings.length} warning(s) — review before submitting, but these won&apos;t block the snapshot.
        </p>
      ) : null}
    </div>
  );
}
