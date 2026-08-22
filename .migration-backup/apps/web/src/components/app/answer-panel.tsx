"use client";

import { useRef, useState, useTransition } from "react";

import { cn } from "@/lib/cn";
import { answerSemanticStatus } from "@/lib/status";
import { approveAnswerAction, editAnswerAction, generateAnswerAction, rejectAnswerAction } from "@/server/answers/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SemanticBadge } from "@/components/ui/status-pill";

// ─── Types ────────────────────────────────────────────────────────────────────

type ClaimFlag = {
  claim: string;
  supported: boolean;
  evidenceId: string | null;
  reason: string;
};

type EvidenceItem = {
  id: string;
  title: string;
  kind: string;
  organization: string | null;
  situation: string | null;
  action: string | null;
  outcome: string | null;
  skills: string[];
};

type AnswerData = {
  id: string;
  applicationId: string;
  questionId: string;
  state: string;
  originalAiText: string | null;
  userEditedText: string | null;
  approvedText: string | null;
  evidenceIds: string[];
  claimFlags: ClaimFlag[];
  missingFacts: string[];
  warnings: string[];
  groundingScore: number;
  generationCount: number;
};

type QuestionData = {
  id: string;
  prompt: string;
  limitValue: number | null;
  limitUnit: string | null;
  required: boolean;
};

// ─── Evidence card ────────────────────────────────────────────────────────────

function EvidenceCard({ item, highlighted }: { item: EvidenceItem; highlighted: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-sm transition-colors",
        highlighted
          ? "border-violet-200 bg-violet-50/60"
          : "border-line bg-surface",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-ink-base">{item.title}</span>
        <span className="shrink-0 rounded-full bg-ink-muted/10 px-2 py-0.5 text-xs text-ink-muted capitalize">
          {item.kind.replace(/_/g, " ")}
        </span>
      </div>
      {item.organization && (
        <p className="mt-0.5 text-xs text-ink-muted">{item.organization}</p>
      )}
      {item.action && (
        <p className="mt-1 text-xs text-ink-subtle line-clamp-2">{item.action}</p>
      )}
      {item.outcome && (
        <p className="mt-0.5 text-xs text-emerald-700">{item.outcome}</p>
      )}
      {item.skills.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.skills.slice(0, 4).map((skill) => (
            <span
              key={skill}
              className="rounded-full border border-line bg-white px-2 py-0.5 text-xs text-ink-muted"
            >
              {skill}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Claim flags panel ────────────────────────────────────────────────────────

function ClaimFlagsPanel({ flags }: { flags: ClaimFlag[] }) {
  const unsupported = flags.filter((f) => !f.supported);
  if (unsupported.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <p className="mb-2 text-xs font-semibold text-amber-800">
        {unsupported.length} claim{unsupported.length > 1 ? "s" : ""} not fully backed by evidence
      </p>
      <ul className="space-y-1.5">
        {unsupported.map((flag, i) => (
          <li key={i} className="flex gap-2 text-xs text-amber-700">
            <span className="mt-0.5 shrink-0 text-amber-400">▲</span>
            <span>
              <span className="line-clamp-2">{flag.claim}</span>
              <span className="mt-0.5 block text-amber-500">{flag.reason.replace(/_/g, " ")}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Missing facts panel ──────────────────────────────────────────────────────

function MissingFactsPanel({ facts }: { facts: string[] }) {
  if (facts.length === 0) return null;
  return (
    <div className="rounded-lg border border-sand-200 bg-sand-soft/50 p-3">
      <p className="mb-2 text-xs font-semibold text-sand-text">Missing information</p>
      <ul className="space-y-1">
        {facts.map((fact, i) => (
          <li key={i} className="flex gap-2 text-xs text-ink-muted">
            <span className="shrink-0 text-sand-text">–</span>
            {fact}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Grounding score bar ──────────────────────────────────────────────────────

function GroundingBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 90 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-2 text-xs text-ink-muted">
      <span className="shrink-0">Grounding</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 tabular-nums">{pct}%</span>
    </div>
  );
}

// ─── Main answer panel ────────────────────────────────────────────────────────

export function AnswerPanel({
  question,
  answer,
  availableEvidence,
}: {
  question: QuestionData;
  answer: AnswerData | null;
  availableEvidence: EvidenceItem[];
}) {
  const [isPending, startTransition] = useTransition();
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState("");
  const [tone, setTone] = useState<"formal" | "enthusiastic" | "concise" | "detailed">("formal");
  const [intent, setIntent] = useState<"draft" | "shorten" | "expand" | "adjust_tone">("draft");
  const formRef = useRef<HTMLFormElement>(null);

  const displayText =
    answer?.userEditedText ?? answer?.originalAiText ?? "";
  const citedEvidence = availableEvidence.filter(
    (e) => answer?.evidenceIds.includes(e.id),
  );
  const status = answer ? answerSemanticStatus(answer.state) : "unknown";

  function submit(fd: FormData) {
    startTransition(async () => {
      await generateAnswerAction(fd);
    });
  }

  function handleApprove() {
    const fd = new FormData();
    fd.set("answerId", answer!.id);
    fd.set("applicationId", answer!.applicationId);
    startTransition(async () => {
      await approveAnswerAction(fd);
    });
  }

  function handleReject() {
    const fd = new FormData();
    fd.set("answerId", answer!.id);
    fd.set("applicationId", answer!.applicationId);
    startTransition(async () => {
      await rejectAnswerAction(fd);
    });
  }

  function handleSaveEdit() {
    const fd = new FormData();
    fd.set("answerId", answer!.id);
    fd.set("applicationId", answer!.applicationId);
    fd.set("text", editText);
    startTransition(async () => {
      await editAnswerAction(fd);
      setEditMode(false);
    });
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      {/* Question header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink-base">{question.prompt}</p>
          {(question.limitValue ?? 0) > 0 && (
            <p className="mt-0.5 text-xs text-ink-muted">
              Max {question.limitValue} {question.limitUnit ?? "characters"}
              {question.required ? " · Required" : " · Optional"}
            </p>
          )}
        </div>
        {answer && <SemanticBadge status={status} />}
      </div>

      {/* Answer text / edit area */}
      {editMode ? (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-[140px] w-full rounded-lg border border-line bg-white p-3 text-sm text-ink-base focus:outline-none focus:ring-2 focus:ring-violet-300"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            aria-label="Edit answer"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSaveEdit} disabled={isPending}>
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditMode(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : displayText ? (
        <div>
          <p className="whitespace-pre-wrap text-sm text-ink-base leading-relaxed">
            {displayText}
          </p>
          {answer && answer.state === "user_edited" && answer.originalAiText && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-ink-muted hover:text-ink-base">
                Original AI draft
              </summary>
              <p className="mt-1 whitespace-pre-wrap text-xs text-ink-subtle leading-relaxed">
                {answer.originalAiText}
              </p>
            </details>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-muted italic">No answer generated yet.</p>
      )}

      {/* Grounding + claim flags + missing facts */}
      {answer && (
        <div className="flex flex-col gap-2">
          {answer.groundingScore > 0 && <GroundingBar score={answer.groundingScore} />}
          <ClaimFlagsPanel flags={answer.claimFlags} />
          <MissingFactsPanel facts={answer.missingFacts} />
        </div>
      )}

      {/* Evidence used */}
      {citedEvidence.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold text-ink-muted">
            Based on {citedEvidence.length} evidence item{citedEvidence.length > 1 ? "s" : ""}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {citedEvidence.map((item) => (
              <EvidenceCard key={item.id} item={item} highlighted />
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {/* Generate form */}
        <form ref={formRef} action={submit} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="applicationId" value={answer?.applicationId ?? ""} />
          <input type="hidden" name="questionId" value={question.id} />
          <input type="hidden" name="previousAnswerId" value={answer?.id ?? ""} />
          <input type="hidden" name="previousAnswerText" value={displayText} />
          <input type="hidden" name="previousGenerationCount" value={answer?.generationCount ?? 0} />
          <input type="hidden" name="intent" value={intent} />
          <input type="hidden" name="tone" value={tone} />

          <select
            className="rounded-md border border-line bg-white px-2 py-1.5 text-xs text-ink-base focus:outline-none focus:ring-2 focus:ring-violet-200"
            value={intent}
            onChange={(e) => setIntent(e.target.value as typeof intent)}
            aria-label="Generation intent"
          >
            <option value="draft">Draft</option>
            <option value="shorten">Shorten</option>
            <option value="expand">Expand</option>
            <option value="adjust_tone">Adjust tone</option>
          </select>

          <select
            className="rounded-md border border-line bg-white px-2 py-1.5 text-xs text-ink-base focus:outline-none focus:ring-2 focus:ring-violet-200"
            value={tone}
            onChange={(e) => setTone(e.target.value as typeof tone)}
            aria-label="Tone"
          >
            <option value="formal">Formal</option>
            <option value="enthusiastic">Enthusiastic</option>
            <option value="concise">Concise</option>
            <option value="detailed">Detailed</option>
          </select>

          <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
            {isPending ? "Generating…" : answer ? "Regenerate" : "Generate"}
          </Button>
        </form>

        {/* Edit */}
        {displayText && !editMode && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditText(displayText);
              setEditMode(true);
            }}
          >
            Edit
          </Button>
        )}

        {/* Approve / Reject */}
        {answer && answer.state !== "approved" && displayText && (
          <>
            <Button
              size="sm"
              onClick={handleApprove}
              disabled={isPending}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={handleReject}
              disabled={isPending}
            >
              Reject
            </Button>
          </>
        )}

        {answer?.state === "approved" && (
          <span className="text-xs font-medium text-emerald-700">✓ Approved</span>
        )}
      </div>

      {/* Generation count */}
      {(answer?.generationCount ?? 0) > 0 && (
        <p className="text-xs text-ink-muted">
          Generated {answer!.generationCount} time{answer!.generationCount > 1 ? "s" : ""}
        </p>
      )}
    </Card>
  );
}

// ─── Answers section (list of questions) ─────────────────────────────────────

export function AnswersSection({
  questions,
  answers,
  availableEvidence,
}: {
  applicationId: string;
  questions: QuestionData[];
  answers: AnswerData[];
  availableEvidence: EvidenceItem[];
}) {
  const answerByQuestion = new Map(answers.map((a) => [a.questionId, a]));

  if (questions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line p-8 text-center">
        <p className="text-sm text-ink-muted">No questions found for this opportunity.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {questions.map((q) => (
        <AnswerPanel
          key={q.id}
          question={q}
          answer={answerByQuestion.get(q.id) ?? null}
          availableEvidence={availableEvidence}
        />
      ))}
    </div>
  );
}
