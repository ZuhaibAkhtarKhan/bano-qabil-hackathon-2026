/**
 * Browser-context helpers for Playwright page.evaluate.
 * Must stay self-contained — no imports from Node or form-engine.
 */

export type CapturedFormField = {
  fieldId: string;
  fieldKey: string;
  type: string;
  label: string;
  required?: boolean;
  options?: string[];
  currentValue?: string;
};

export type CapturedFormPage = {
  fields: CapturedFormField[];
  hazards: {
    captcha: boolean;
    accountCreation: boolean;
    unsupported: boolean;
    hasSubmitControl: boolean;
  };
  pageText: string;
};

export type FillPlanEntry = {
  fieldId: string;
  status: "filled" | "need_you";
  value?: string;
  type?: string;
  documentVersionId?: string;
};

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableFieldId(key: string, name: string, id: string): string {
  return `f_${fnv1aHex(`${key}\0${name}\0${id}`)}`;
}

function controlSignal(el: Element): string {
  const node = el as HTMLElement;
  return [
    node.textContent ?? "",
    node.getAttribute("aria-label") ?? "",
    node.getAttribute("title") ?? "",
    node.getAttribute("value") ?? "",
    node.id ?? "",
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function labelsMatch(label: string, target: string): boolean {
  const a = label.toLowerCase();
  const b = target.toLowerCase();
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const aTokens = normalizeTokens(a);
  const bTokens = normalizeTokens(b);
  if (!aTokens.length || !bTokens.length) return false;
  const overlap = aTokens.filter((token) => bTokens.includes(token)).length;
  return overlap >= Math.min(2, Math.min(aTokens.length, bTokens.length));
}

function toHtmlDateValue(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function valueForNativeInput(el: HTMLInputElement | HTMLTextAreaElement, value: string): string | null {
  const type = el instanceof HTMLInputElement ? (el.type || "text").toLowerCase() : "textarea";
  if (type === "date") return toHtmlDateValue(value);
  if (type === "number") {
    const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    return match ? match[0] : null;
  }
  if (type === "url") {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.includes(".")) return `https://${trimmed}`;
    return trimmed || null;
  }
  if (type === "tel") return value.replace(/[^\d+().-\s]/g, "").trim() || null;
  return value.trim() || null;
}

function looksLikeFileField(item: Element, label: string): boolean {
  if (item.querySelector('input[type="file"]')) return true;
  const text = `${label} ${item.textContent ?? ""}`.toLowerCase();
  return /add file|upload file|attach|resume|cv|cover letter|portfolio|transcript|browse/i.test(text);
}

function classifyButton(el: Element): "next" | "submit" | "other" {
  const text = controlSignal(el);
  if (/\b(next|continue|proceed|save\s*(&|and)?\s*continue)\b/i.test(text)) return "next";
  if (/\b(submit|send|finish)\b/i.test(text) && !/\b(next|continue)\b/i.test(text)) return "submit";
  const type = (el as HTMLInputElement).type?.toLowerCase?.() ?? "";
  if (type === "submit" && /\bsubmit\b/i.test(text)) return "submit";
  return "other";
}

function visible(el: Element): boolean {
  const node = el as HTMLElement;
  if ((node as HTMLButtonElement).disabled) return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 2 && rect.height > 2;
}

/** Inventory current page — Google Forms + generic HTML forms. */
export function captureFormPage(): CapturedFormPage {
  const BATCH_ATTR = "data-1apply-batch-id";
  const pageText = (document.body?.innerText ?? "").slice(0, 20_000);
  const html = document.documentElement.outerHTML;
  const captcha = /captcha|recaptcha|hcaptcha|turnstile/i.test(html + pageText);
  const accountCreation = /create an account|sign up to apply|register to continue/i.test(pageText);
  const buttons = Array.from(
    document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]'),
  );
  const hasSubmitControl = buttons.some((btn) => classifyButton(btn) === "submit" && visible(btn));

  const fields: CapturedFormField[] = [];
  const seen = new Set<string>();

  const listItems = Array.from(document.querySelectorAll('[role="listitem"]'));
  for (const item of listItems) {
    const heading = item.querySelector('[role="heading"], .M7eMe, .freebirdFormviewerComponentsQuestionBaseTitle');
    const label = (heading?.textContent ?? item.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
    if (!label || label.length < 2) continue;

    const key = label.slice(0, 120);
    const fieldKey = key.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 80) || `field_${fields.length}`;
    const fieldId = stableFieldId(fieldKey, fieldKey, String(fields.length));

    let type = "text";
    let options: string[] | undefined;
    if (item.querySelector('[role="radio"]')) {
      type = "radio";
      options = Array.from(item.querySelectorAll('[role="radio"]'))
        .map((node) => (node.getAttribute("aria-label") ?? node.textContent ?? "").trim())
        .filter(Boolean);
    } else if (item.querySelector('[role="checkbox"]')) {
      type = "checkbox";
      options = Array.from(item.querySelectorAll('[role="checkbox"]'))
        .map((node) => (node.getAttribute("aria-label") ?? node.textContent ?? "").trim())
        .filter(Boolean);
    } else if (item.querySelector('[role="listbox"]')) {
      type = "select";
    } else if (item.querySelector('input[type="file"]')) {
      type = "file";
    } else if (item.querySelector("textarea")) {
      type = "textarea";
    } else if (item.querySelector('input[type="email"]')) {
      type = "email";
    } else if (looksLikeFileField(item, label)) {
      type = "file";
    } else {
      const native = item.querySelector("input") as HTMLInputElement | null;
      if (native?.type === "date") type = "date";
      else if (native?.type === "number") type = "number";
      else if (native?.type === "url") type = "url";
      else if (native?.type === "tel") type = "tel";
    }

    item.setAttribute(BATCH_ATTR, fieldId);
    if (seen.has(fieldId)) continue;
    seen.add(fieldId);
    fields.push({
      fieldId,
      fieldKey,
      type,
      label,
      required: /required|\*/i.test(item.textContent ?? ""),
      options,
    });
  }

  if (fields.length === 0) {
    const inputs = Array.from(
      document.querySelectorAll<HTMLElement>(
        'input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select, [contenteditable="true"], [role="textbox"]',
      ),
    );
    for (const el of inputs) {
      const label =
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        (el as HTMLInputElement).name ||
        el.id ||
        `Field ${fields.length + 1}`;
      const fieldKey = String(label)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .slice(0, 80);
      const fieldId = stableFieldId(fieldKey, (el as HTMLInputElement).name ?? "", el.id ?? "");
      el.setAttribute(BATCH_ATTR, fieldId);
      if (seen.has(fieldId)) continue;
      seen.add(fieldId);
      let type = "text";
      if (el instanceof HTMLSelectElement) type = "select";
      else if (el instanceof HTMLTextAreaElement) type = "textarea";
      else if (el instanceof HTMLInputElement) {
        if (el.type === "radio") type = "radio";
        else if (el.type === "checkbox") type = "checkbox";
        else if (el.type === "file") type = "file";
        else if (el.type === "date") type = "date";
        else if (el.type === "number") type = "number";
        else if (el.type === "url") type = "url";
        else if (el.type === "tel") type = "tel";
        else type = el.type || "text";
      } else if (el.getAttribute("contenteditable") === "true" || el.getAttribute("role") === "textbox") {
        type = "textarea";
      }
      fields.push({ fieldId, fieldKey, type, label: String(label).trim() });
    }
  }

  return {
    fields,
    hazards: { captcha, accountCreation, unsupported: false, hasSubmitControl },
    pageText,
  };
}

function findByBatchId(fieldId: string): HTMLElement | null {
  return document.querySelector(`[data-1apply-batch-id="${fieldId}"]`) as HTMLElement | null;
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function applyField(item: HTMLElement, entry: FillPlanEntry): boolean {
  if (entry.status !== "filled") return false;
  const type = entry.type ?? "text";
  if (type === "file" || entry.documentVersionId) return false;

  const value = entry.value?.trim() ?? "";
  if (!value) return false;

  if (type === "radio" || item.querySelector('[role="radio"]')) {
    const target = value.toLowerCase();
    const radios = Array.from(item.querySelectorAll('[role="radio"], input[type="radio"]'));
    for (const node of radios) {
      const label = controlSignal(node);
      if (labelsMatch(label, value) || label.toLowerCase().includes(target) || target.includes(label.toLowerCase())) {
        (node as HTMLElement).click();
        return true;
      }
    }
    return false;
  }

  if (type === "checkbox" || item.querySelector('[role="checkbox"]')) {
    const wanted = value
      .split(/\n|;/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    let changed = false;
    for (const node of Array.from(item.querySelectorAll('[role="checkbox"], input[type="checkbox"]'))) {
      const label = controlSignal(node).toLowerCase();
      const should = wanted.some((part) => label.includes(part) || part.includes(label));
      const checked =
        node.getAttribute("aria-checked") === "true" || (node as HTMLInputElement).checked;
      if (checked !== should) {
        (node as HTMLElement).click();
        changed = true;
      }
    }
    return changed || Boolean(wanted.length);
  }

  if (type === "select" || item.querySelector('[role="listbox"]')) {
    const listbox = item.querySelector('[role="listbox"]') as HTMLElement | null;
    if (listbox) {
      listbox.click();
      const options = Array.from(document.querySelectorAll('[role="option"], [role="menuitemradio"]'));
      for (const opt of options) {
        if (labelsMatch(controlSignal(opt), value)) {
          (opt as HTMLElement).click();
          return true;
        }
      }
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
    const select = item.querySelector("select") as HTMLSelectElement | null;
    if (select) {
      const match =
        Array.from(select.options).find((opt) => opt.value === value) ||
        Array.from(select.options).find((opt) => (opt.textContent ?? "").toLowerCase().includes(value.toLowerCase()));
      if (!match) return false;
      select.value = match.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
  }

  const textarea = item.querySelector("textarea") as HTMLTextAreaElement | null;
  if (textarea) {
    setNativeValue(textarea, value);
    return Boolean(textarea.value.trim());
  }

  const input = item.querySelector<HTMLInputElement>(
    'input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox])',
  );
  if (input) {
    const next = valueForNativeInput(input, value);
    if (!next) return false;
    setNativeValue(input, next);
    return Boolean(input.value.trim());
  }

  const editable = item.querySelector<HTMLElement>('[contenteditable="true"], [role="textbox"]');
  if (editable) {
    editable.focus();
    editable.textContent = value;
    editable.dispatchEvent(new InputEvent("input", { bubbles: true }));
    return Boolean((editable.textContent ?? "").trim());
  }

  return false;
}

export function applyFillPlan(entries: FillPlanEntry[]): { filled: number; skipped: number } {
  let filled = 0;
  let skipped = 0;
  for (const entry of entries) {
    const item = findByBatchId(entry.fieldId);
    if (!item) {
      skipped += 1;
      continue;
    }
    if (applyField(item, entry)) filled += 1;
    else skipped += 1;
  }
  return { filled, skipped };
}

export function clickFormControl(kind: "next" | "submit"): { clicked: boolean; reason?: string } {
  const buttons = Array.from(
    document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], span[role="link"]'),
  ) as HTMLElement[];
  const matches = buttons.filter((btn) => classifyButton(btn) === kind && visible(btn));
  const preferred =
    matches.find((btn) =>
      kind === "next"
        ? /\b(next|continue)\b/i.test(controlSignal(btn))
        : /\bsubmit\b/i.test(controlSignal(btn)),
    ) ?? matches[matches.length - 1];
  if (!preferred) return { clicked: false, reason: kind === "next" ? "no-next" : "no-submit" };
  preferred.scrollIntoView({ block: "center" });
  preferred.click();
  return { clicked: true };
}

export function clickNextControl(): { clicked: boolean; reason?: string } {
  return clickFormControl("next");
}

export function clickSubmitControl(): { clicked: boolean; reason?: string } {
  return clickFormControl("submit");
}

export function detectSubmissionConfirmation(): boolean {
  const text = (document.body?.innerText ?? "").toLowerCase();
  return (
    /response recorded|thank you|submission received|your response has been recorded|recorded your response|تم إرسال/i.test(
      text,
    ) || /formresponse/i.test(location.href)
  );
}
