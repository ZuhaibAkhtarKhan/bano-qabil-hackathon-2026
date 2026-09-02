"use client";

import { useState, useTransition } from "react";

import { useNeedsYouSave } from "@/components/app/needs-you-save-hook";
import { type NeedsYouItem } from "@/lib/needs-you";
import { parseNeedsYouMultiValues } from "@/lib/needs-you-field-kinds";
import { generateNeedsYouDraftAction, resolveNeedsYouValue } from "@/server/needs-you/actions";
import { Button, SubmitButton } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

function htmlInputType(item: NeedsYouItem): string {
  switch (item.inputType) {
    case "date":
      return "date";
    case "number":
      return "number";
    case "url":
      return "url";
    case "email":
      return "email";
    case "tel":
      return "tel";
    default:
      return "text";
  }
}

export function supportsNeedsYouAiDraft(item: NeedsYouItem): boolean {
  return item.inputType === "text" || item.inputType === "textarea";
}

/** Text / select / multi-select / date / number questions, with optional Generate by AI for text fields. */
export function NeedsYouQuestionForm({ item }: { item: NeedsYouItem }) {
  const inputId = `${item.id}-value`;
  const initialMulti = parseNeedsYouMultiValues(item.payload.currentValue);
  const [value, setValue] = useState(item.payload.currentValue?.trim() || "");
  const [selected, setSelected] = useState<string[]>(initialMulti);
  const [selectValue, setSelectValue] = useState(
    item.payload.currentValue && (item.options ?? []).includes(item.payload.currentValue)
      ? item.payload.currentValue
      : "",
  );
  const [tone, setTone] = useState<"formal" | "enthusiastic" | "concise" | "detailed">("formal");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [isGenerating, startGenerate] = useTransition();
  const { isPending, feedbackNotice, submit } = useNeedsYouSave({ itemId: item.id });
  const canGenerate = supportsNeedsYouAiDraft(item);
  const options = item.options ?? [];

  function toggleOption(option: string) {
    setSelected((current) =>
      current.includes(option) ? current.filter((entry) => entry !== option) : [...current, option],
    );
  }

  function runGenerate() {
    setGenerateError(null);
    const fd = new FormData();
    fd.set("applicationId", item.applicationId);
    fd.set("label", item.title);
    fd.set("detail", item.detail ?? "");
    fd.set("tone", tone);
    if (item.payload.questionId) fd.set("questionId", item.payload.questionId);

    startGenerate(async () => {
      const result = await generateNeedsYouDraftAction(fd);
      if (result.error || !result.draft) {
        setGenerateError(
          result.error === "no_evidence"
            ? "Not enough Application Memory yet to draft this."
            : result.error === "ai_unavailable"
              ? "AI is not configured."
              : "Could not generate a draft. Try again or write it yourself.",
        );
        return;
      }
      setValue(result.draft);
    });
  }

  function buildFormData(scope: "memory" | "application") {
    const fd = new FormData();
    fd.set("applicationId", item.applicationId);
    fd.set("label", item.title);
    fd.set("detail", item.detail ?? "");
    fd.set("inputType", item.inputType);
    fd.set("scope", scope);
    if (item.payload.profileField) fd.set("profileField", item.payload.profileField);
    if (item.payload.reviewItemId) fd.set("reviewItemId", item.payload.reviewItemId);
    if (item.payload.questionId) fd.set("questionId", item.payload.questionId);
    if (item.payload.answerId) fd.set("answerId", item.payload.answerId);
    if (item.payload.mappingId) fd.set("mappingId", item.payload.mappingId);
    if (item.payload.eligibilityId) fd.set("eligibilityId", item.payload.eligibilityId);

    if (item.inputType === "multi-select") {
      for (const option of selected) fd.append("value", option);
    } else if (item.inputType === "select") {
      fd.set("value", selectValue);
    } else {
      fd.set("value", value);
    }
    return fd;
  }

  function save(scope: "memory" | "application") {
    submit(() => buildFormData(scope), resolveNeedsYouValue);
  }

  return (
    <div className="grid gap-3">
      {canGenerate ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-[#fafbf8] px-3 py-2.5">
          <label className="sr-only" htmlFor={`${item.id}-tone`}>
            Tone
          </label>
          <select
            id={`${item.id}-tone`}
            className="rounded-md border border-line bg-white px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-ink/15"
            value={tone}
            onChange={(event) => setTone(event.target.value as typeof tone)}
            disabled={isGenerating || isPending}
          >
            <option value="formal">Formal</option>
            <option value="enthusiastic">Enthusiastic</option>
            <option value="concise">Concise</option>
            <option value="detailed">Detailed</option>
          </select>
          <Button type="button" size="sm" variant="secondary" disabled={isGenerating || isPending} onClick={runGenerate}>
            {isGenerating ? "Generating…" : "Generate by AI"}
          </Button>
          <p className="text-[11px] text-ink-muted">Uses Application Memory only — review before saving.</p>
        </div>
      ) : null}

      {isGenerating ? (
        <div className="rounded-xl border border-line bg-white px-4 py-3 text-xs text-ink-muted">
          Drafting from verified kit facts…
        </div>
      ) : null}

      {generateError ? <p className="text-xs text-coral">{generateError}</p> : null}
      {feedbackNotice}

      <div className="grid gap-3">
        <Field label={item.inputLabel || "Your answer"} htmlFor={inputId}>
          {item.inputType === "textarea" ? (
            <Textarea
              id={inputId}
              required
              rows={item.kind === "answer" ? 5 : 4}
              placeholder="Enter the value for this question…"
              value={value}
              disabled={isPending}
              onChange={(event) => setValue(event.target.value)}
            />
          ) : item.inputType === "multi-select" && options.length > 0 ? (
            <fieldset id={inputId} className="grid gap-2 rounded-xl border border-line bg-white p-3">
              <legend className="sr-only">{item.inputLabel || "Choose all that apply"}</legend>
              {options.map((option, index) => {
                const checked = selected.includes(option);
                const optionId = `${item.id}-${option.slice(0, 40)}`;
                return (
                  <label
                    key={option}
                    htmlFor={optionId}
                    className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-[#f7f8f4]"
                  >
                    <input
                      id={optionId}
                      type="checkbox"
                      value={option}
                      checked={checked}
                      disabled={isPending}
                      required={item.required && selected.length === 0 && index === 0}
                      onChange={() => toggleOption(option)}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-line text-ink focus:ring-ink/20"
                    />
                    <span className="leading-snug">{option}</span>
                  </label>
                );
              })}
            </fieldset>
          ) : item.inputType === "select" && options.length > 0 ? (
            <Select
              id={inputId}
              required
              value={selectValue}
              disabled={isPending}
              onChange={(event) => setSelectValue(event.target.value)}
            >
              <option value="" disabled>
                Select an option…
              </option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id={inputId}
              type={htmlInputType(item)}
              required
              placeholder="Enter the value for this question…"
              value={value}
              disabled={isPending}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
        </Field>

        <div className="flex flex-wrap gap-2">
          <SubmitButton
            type="button"
            pending={isPending}
            pendingText="Saving to memory…"
            onClick={() => save("memory")}
          >
            Save to memory
          </SubmitButton>
          <SubmitButton
            type="button"
            variant="secondary"
            pending={isPending}
            pendingText="Filling application…"
            onClick={() => save("application")}
          >
            Fill just for this application
          </SubmitButton>
        </div>
        <p className="text-xs leading-5 text-ink-muted">
          <span className="font-medium text-ink">Save to memory</span> keeps this for every future
          application.{" "}
          <span className="font-medium text-ink">Fill just for this application</span> uses it only
          here and does not update Application Memory.
        </p>
      </div>
    </div>
  );
}
