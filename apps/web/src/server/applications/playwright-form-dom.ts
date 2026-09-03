/**
 * Browser-context helpers for Playwright page.evaluate.
 * Must stay self-contained — no imports from Node or form-engine.
 *
 * CRITICAL: Pass `executeFormDomInPage` directly to page.evaluate.
 * Do NOT toString()/new Function() individual helpers — production minify
 * renames free variables inconsistently across separately stringified functions
 * (e.g. ReferenceError: o is not defined).
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

export type FormDomAction = "capture" | "apply" | "next" | "submit" | "confirm";

export type FormDomEvaluateInput = {
  action: FormDomAction;
  arg?: FillPlanEntry[];
};

export type FormDomEvaluateResult =
  | CapturedFormPage
  | { filled: number; skipped: number }
  | { clicked: boolean; reason?: string }
  | boolean;

/**
 * Single entry point for Playwright page.evaluate.
 * All helpers are nested so minify keeps references consistent inside this closure.
 */
export function executeFormDomInPage(input: FormDomEvaluateInput): FormDomEvaluateResult {
  const action = input.action;
  const arg = input.arg;

  function fnv1aHex(raw: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < raw.length; i += 1) {
      hash ^= raw.charCodeAt(i);
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
    const nextRe =
      /\b(next|continue|proceed|forward|go\s*next|next\s*page|next\s*step|keep\s*going|save\s*(&|and)?\s*continue|weiter|siguiente|suivant|avanti|dalej|volgende|próximo|proximo|nästa|neste)\b/i;
    const submitRe =
      /\b(submit|send|finish|done|apply|complete|confirm|register|enroll|save\s*(&|and)?\s*submit|final\s*submit|send\s*(response|application|form)|submit\s*(response|application|form|answers)|absenden|enviar|envoyer|invia|wyślij|einreichen|abschicken|senden)\b/i;
    if (nextRe.test(text)) return "next";
    if (submitRe.test(text) && !nextRe.test(text)) return "submit";
    const type = (el as HTMLInputElement).type?.toLowerCase?.() ?? "";
    if (type === "submit") {
      if (submitRe.test(text) || !text.trim()) return "submit";
    }
    return "other";
  }

  function visible(el: Element): boolean {
    const node = el as HTMLElement;
    if ((node as HTMLButtonElement).disabled) return false;
    try {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    } catch {
      // ignore
    }
    const rect = node.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  }

  /** Must match BatchFieldTypeSchema — never emit HTML input types like email/tel. */
  function normalizeBatchFieldType(raw: string): string {
    const type = (raw || "text").toLowerCase().trim();
    if (type === "textarea") return "textarea";
    if (type === "select" || type === "multi-select") return "select";
    if (type === "radio") return "radio";
    if (type === "checkbox") return "checkbox";
    if (type === "file") return "file";
    if (type === "contenteditable") return "contenteditable";
    if (type === "date" || type === "datetime-local" || type === "month" || type === "week" || type === "time") {
      return "date";
    }
    if (type === "number" || type === "range") return "number";
    if (type === "url") return "url";
    // email, tel, search, password, text, and anything else → text fill path
    return "text";
  }

  function isInvisibleOrBadgeCaptcha(el: Element): boolean {
    if (el.closest(".grecaptcha-badge, .h-captcha-badge")) return true;
    if (el.getAttribute("data-size") === "invisible") return true;
    const src = (el.getAttribute("src") ?? "").toLowerCase();
    // Privacy badge / challenge popup / invisible widget — not a blocking checkbox on the form.
    if (src.includes("badge") || src.includes("/bframe") || /[?&]size=invisible\b/.test(src)) return true;
    return false;
  }

  function isBlockingCaptchaWidget(el: Element): boolean {
    return visible(el) && !isInvisibleOrBadgeCaptcha(el);
  }

  function captureFormPage(): CapturedFormPage {
    const BATCH_ATTR = "data-1apply-batch-id";
    const pageText = (document.body?.innerText ?? "").slice(0, 20_000);

    // Only treat CAPTCHA as present when a challenge widget is actually visible.
    // Matching /recaptcha|captcha|turnstile/ against full outerHTML false-positives on
    // Google Forms and other pages that load inactive scripts/strings in the HTML.
    function detectVisibleCaptcha(): boolean {
      const selectors = [
        ".g-recaptcha",
        ".h-captcha",
        ".cf-turnstile",
        "iframe[src*='recaptcha']",
        "iframe[src*='hcaptcha']",
        "iframe[src*='turnstile']",
        "iframe[src*='challenges.cloudflare.com']",
        "#captcha",
        "[data-captcha-widget]",
      ];
      for (const selector of selectors) {
        for (const el of Array.from(document.querySelectorAll(selector))) {
          if (isBlockingCaptchaWidget(el)) return true;
        }
      }
      // Challenge copy alone is not enough; require a visible iframe/widget with it.
      if (/\bi'?m not a robot\b|\bverify you are (a )?human\b|\bcomplete the captcha\b/i.test(pageText)) {
        for (const challenge of Array.from(
          document.querySelectorAll(
            "iframe[src*='recaptcha'], iframe[src*='hcaptcha'], iframe[src*='turnstile'], .g-recaptcha, .h-captcha, .cf-turnstile",
          ),
        )) {
          if (isBlockingCaptchaWidget(challenge)) return true;
        }
      }
      return false;
    }

    function detectAccountWall(): boolean {
      const password = document.querySelector('input[type="password"]');
      if (!password || !visible(password)) return false;
      const email = document.querySelector('input[type="email"], input[name*="email" i]');
      const createCopy = /create (your )?account|sign up to apply|register to continue|sign up to continue/i.test(
        pageText,
      );
      return Boolean(email && createCopy);
    }

    const captcha = detectVisibleCaptcha();
    const accountCreation = detectAccountWall();
    const buttons = Array.from(
      document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]'),
    );
    const hasSubmitControl = buttons.some((btn) => classifyButton(btn) === "submit" && visible(btn));

    const fields: CapturedFormField[] = [];
    const seen = new Set<string>();

    const listItems = Array.from(document.querySelectorAll('[role="listitem"]'));
    for (const item of listItems) {
      const heading = item.querySelector(
        '[role="heading"], .M7eMe, .freebirdFormviewerComponentsQuestionBaseTitle',
      );
      const label = (heading?.textContent ?? item.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
      if (!label || label.length < 2) continue;

      const key = label.slice(0, 120);
      const fieldKey =
        key.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 80) || `field_${fields.length}`;
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
      } else if (looksLikeFileField(item, label)) {
        type = "file";
      } else {
        const native = item.querySelector("input") as HTMLInputElement | null;
        // email/tel/search map to text via normalizeBatchFieldType
        type = normalizeBatchFieldType(native?.type || "text");
      }

      item.setAttribute(BATCH_ATTR, fieldId);
      if (seen.has(fieldId)) continue;
      seen.add(fieldId);
      fields.push({
        fieldId,
        fieldKey,
        type: normalizeBatchFieldType(type),
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
          else type = normalizeBatchFieldType(el.type || "text");
        } else if (el.getAttribute("contenteditable") === "true" || el.getAttribute("role") === "textbox") {
          type = "textarea";
        }
        fields.push({
          fieldId,
          fieldKey,
          type: normalizeBatchFieldType(type),
          label: String(label).trim(),
        });
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
        if (
          labelsMatch(label, value) ||
          label.toLowerCase().includes(target) ||
          target.includes(label.toLowerCase())
        ) {
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
          Array.from(select.options).find((opt) =>
            (opt.textContent ?? "").toLowerCase().includes(value.toLowerCase()),
          );
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

    const nativeInput = item.querySelector<HTMLInputElement>(
      "input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox])",
    );
    if (nativeInput) {
      const next = valueForNativeInput(nativeInput, value);
      if (!next) return false;
      setNativeValue(nativeInput, next);
      return Boolean(nativeInput.value.trim());
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

  function applyFillPlan(entries: FillPlanEntry[]): { filled: number; skipped: number } {
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

  function clickFormControl(kind: "next" | "submit"): { clicked: boolean; reason?: string } {
    const buttons = Array.from(
      document.querySelectorAll(
        'button, [role="button"], input[type="submit"], input[type="button"], span[role="link"]',
      ),
    ) as HTMLElement[];
    const matches = buttons.filter((btn) => classifyButton(btn) === kind && visible(btn));
    let preferred =
      matches.find((btn) => {
        const signal = controlSignal(btn);
        return kind === "next"
          ? /\b(next|continue|proceed|forward|go\s*next|next\s*page|next\s*step|weiter|siguiente|suivant)\b/i.test(
              signal,
            )
          : /\b(submit|send|finish|done|apply|complete|confirm|absenden|enviar|envoyer)\b/i.test(signal);
      }) ?? matches[matches.length - 1];

    if (!preferred && kind === "submit") {
      const googleSubmit = document.querySelector(
        '.freebirdFormviewerViewNavigationSubmitButton, [jsname="M2UYVd"], [data-action-id="submit"], [aria-label*="Submit" i], [aria-label*="Send" i]',
      ) as HTMLElement | null;
      if (googleSubmit && visible(googleSubmit)) preferred = googleSubmit;
    }

    if (!preferred && kind === "next") {
      const googleNext = document.querySelector(
        '[jsname="OCpkoe"], .freebirdFormviewerViewNavigationNextButton, [aria-label*="Next" i], [aria-label*="Continue" i]',
      ) as HTMLElement | null;
      if (googleNext && visible(googleNext)) preferred = googleNext;
    }

    if (!preferred) return { clicked: false, reason: kind === "next" ? "no-next" : "no-submit" };
    preferred.scrollIntoView({ block: "center" });
    preferred.click();
    return { clicked: true };
  }

  function clickNextControl(): { clicked: boolean; reason?: string } {
    return clickFormControl("next");
  }

  function clickSubmitControl(): { clicked: boolean; reason?: string } {
    return clickFormControl("submit");
  }

  function detectSubmissionConfirmation(): boolean {
    const text = (document.body?.innerText ?? "").toLowerCase();
    return (
      /response recorded|thank you|submission received|your response has been recorded|recorded your response|تم إرسال|successfully submitted|application received|we have received/i.test(
        text,
      ) || /formresponse/i.test(location.href)
    );
  }

  if (action === "capture") return captureFormPage();
  if (action === "apply") return applyFillPlan(arg ?? []);
  if (action === "next") return clickNextControl();
  if (action === "submit") return clickSubmitControl();
  if (action === "confirm") return detectSubmissionConfirmation();
  throw new Error("unknown_form_dom_action");
}
