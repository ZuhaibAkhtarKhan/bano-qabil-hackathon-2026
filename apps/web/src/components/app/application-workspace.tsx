import Link from "next/link";
import { applicationStatusSchema } from "@1apply/contracts";

import { FlashBanner } from "@/components/app/flash-banner";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScoreIndicator } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SemanticBadge, StatusPill } from "@/components/ui/status-pill";
import {
  addQuestion,
  addRequirement,
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
  const { application, opportunity, questions, eligibility, fit, evidenceRows, documents, attached, snapshots } = data;
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

      <section id="eligibility" className="mt-8 scroll-mt-8">
        <Card className="p-6">
        <h2 className="font-display text-2xl">Eligibility and Fit</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Assistance only — not an official eligibility decision. Unverified evidence never counts as met.
        </p>
        {fit ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)]">
            <ScoreIndicator score={fit.score} />
            <dl className="grid gap-3 sm:grid-cols-4">
              {[
                ["Skills", fit.skills_match],
                ["Experience", fit.experience_match],
                ["Education", fit.education_match],
                ["Projects", fit.project_relevance],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-2xl bg-canvas p-4">
                  <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">{label}</dt>
                  <dd className="mt-1 font-mono text-2xl">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">Run analysis to compute a Fit Index from verified evidence.</p>
        )}
        <ul className="mt-6 grid gap-3">
          {eligibility.length === 0 ? (
            <li className="text-sm text-ink-muted">No requirements yet. Add them so matching has something to check.</li>
          ) : (
            eligibility.map((item) => (
              <li key={item.id} className="rounded-xl border border-line p-4 text-sm">
                <StatusPill
                  tone={item.state === "met" ? "mint" : item.state === "not_met" ? "coral" : "sand"}
                >
                  {item.state.replace("_", " ")}
                </StatusPill>
                <p className="mt-2">{item.explanation}</p>
              </li>
            ))
          )}
        </ul>
        <form action={addRequirement} className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <input type="hidden" name="applicationId" value={application.id} />
          <Field label="Add requirement" htmlFor={`requirement-${application.id}`}>
            <Input id={`requirement-${application.id}`} name="text" required placeholder="Must be available full-time" />
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="hard" />
            Hard
          </label>
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </form>
        {data.resumeMatches.length > 0 ? (
          <div className="mt-6">
            <h3 className="text-sm font-medium">Resume match</h3>
            <ul className="mt-2 grid gap-2 text-sm">
              {data.resumeMatches.map((item) => (
                <li key={item.id}>
                  Score {item.score}
                  {item.suggestion ? ` — ${item.suggestion}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        </Card>
      </section>

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
    </WorkspaceMain>
  );
}
