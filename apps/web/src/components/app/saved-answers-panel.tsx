"use client";

import { useState, useTransition } from "react";

import {
  addSavedAnswer,
  deleteProfileFact,
  generateSavedAnswerDraftAction,
  updateSavedAnswer,
} from "@/server/memory/actions";
import { Button, SubmitButton } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

export type SavedAnswerFact = {
  id: string;
  label: string;
  text: string;
  source: string | null;
};

function sourceChip(source: string | null) {
  if (source === "needs_you") return "Need You";
  if (source === "manual") return "Manual";
  if (source === "extension_fill") return "Extension";
  return source ? source.replace(/_/g, " ") : "Memory";
}

function SavedAnswerEditor({
  initialLabel,
  initialText,
  factId,
}: {
  initialLabel: string;
  initialText: string;
  factId?: string;
}) {
  const [label, setLabel] = useState(initialLabel);
  const [text, setText] = useState(initialText);
  const [tone, setTone] = useState<"formal" | "enthusiastic" | "concise" | "detailed">("formal");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [isGenerating, startGenerate] = useTransition();
  const formAction = factId ? updateSavedAnswer : addSavedAnswer;
  const idPrefix = factId ?? "new";

  function runGenerate() {
    setGenerateError(null);
    if (!label.trim()) {
      setGenerateError("Enter a question first.");
      return;
    }
    const fd = new FormData();
    fd.set("label", label);
    fd.set("tone", tone);
    startGenerate(async () => {
      const result = await generateSavedAnswerDraftAction(fd);
      if (result.error || !result.draft) {
        setGenerateError(
          result.error === "no_evidence"
            ? "Not enough Application Memory yet to draft this."
            : result.error === "ai_unavailable"
              ? "AI is not configured."
              : result.error === "required"
                ? "Enter a question first."
                : "Could not generate a draft. Try again or write it yourself.",
        );
        return;
      }
      setText(result.draft);
    });
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-[#fafbf8] px-3 py-2.5">
        <label className="sr-only" htmlFor={`${idPrefix}-tone`}>
          Tone
        </label>
        <select
          id={`${idPrefix}-tone`}
          className="rounded-md border border-line bg-white px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-ink/15"
          value={tone}
          onChange={(event) => setTone(event.target.value as typeof tone)}
          disabled={isGenerating}
        >
          <option value="formal">Formal</option>
          <option value="enthusiastic">Enthusiastic</option>
          <option value="concise">Concise</option>
          <option value="detailed">Detailed</option>
        </select>
        <Button type="button" size="sm" variant="secondary" disabled={isGenerating} onClick={runGenerate}>
          {isGenerating ? "Generating…" : "Generate by AI"}
        </Button>
        <p className="text-[11px] text-ink-muted">Uses Application Memory only — review before saving.</p>
      </div>

      {isGenerating ? (
        <div className="rounded-xl border border-line bg-white px-4 py-3 text-xs text-ink-muted">
          Drafting from verified kit facts…
        </div>
      ) : null}
      {generateError ? <p className="text-xs text-coral">{generateError}</p> : null}

      <form action={formAction} className="grid gap-3">
        <input type="hidden" name="section" value="answers" />
        {factId ? <input type="hidden" name="factId" value={factId} /> : null}
        <Field label="Question" htmlFor={`${idPrefix}-label`}>
          <Input
            id={`${idPrefix}-label`}
            name="label"
            required
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Why do you want this role?"
          />
        </Field>
        <Field label="Answer" htmlFor={`${idPrefix}-text`}>
          <Textarea
            id={`${idPrefix}-text`}
            name="text"
            required
            rows={5}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Your reusable answer…"
          />
        </Field>
        <SubmitButton variant="secondary" pendingText="Saving…">
          {factId ? "Save changes" : "Add answer"}
        </SubmitButton>
      </form>
    </div>
  );
}

export function SavedAnswersPanel({ facts }: { facts: SavedAnswerFact[] }) {
  return (
    <div className="grid gap-6">
      <p className="text-sm text-ink-muted">
        Questions you saved from Need You (and answers you add here) live in Your kit. Edit, delete, or regenerate with
        AI — they reuse across applications.
      </p>

      {facts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-[#fafbf8]/50 px-4 py-3 text-sm text-ink-muted">
          No saved answers yet. Save a Need You question to memory, or add one manually below.
        </p>
      ) : (
        <ul className="grid gap-4">
          {facts.map((fact) => (
            <li key={fact.id} className="rounded-2xl border border-line bg-white p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                  {sourceChip(fact.source)}
                </span>
                <form action={deleteProfileFact}>
                  <input type="hidden" name="section" value="answers" />
                  <input type="hidden" name="factId" value={fact.id} />
                  <SubmitButton variant="danger" size="sm" pendingText="Deleting…">
                    Delete
                  </SubmitButton>
                </form>
              </div>
              <SavedAnswerEditor factId={fact.id} initialLabel={fact.label} initialText={fact.text} />
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-2xl border border-line bg-[#fafbf8]/50 p-4 sm:p-5">
        <p className="text-sm font-medium text-ink">Add answer manually</p>
        <div className="mt-3">
          <SavedAnswerEditor initialLabel="" initialText="" />
        </div>
      </div>
    </div>
  );
}
