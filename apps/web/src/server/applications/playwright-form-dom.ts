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
  label?: string;
  documentVersionId?: string;
};

export type FormDomAction = "capture" | "apply" | "next" | "submit" | "confirm" | "validation" | "read";

export type FormDomEvaluateInput = {
  action: FormDomAction;
  arg?: FillPlanEntry[];
};

export type FormDomEvaluateResult =
  | CapturedFormPage
  | { filled: number; skipped: number; details?: Array<{ fieldId: string; ok: boolean }> }
  | { clicked: boolean; reason?: string }
  | boolean
  | Array<{ fieldId: string; value: string; empty: boolean }>;

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

  function looksLikeFileField(item: Element): boolean {
    if (item.querySelector('input[type="file"]')) return true;
    const buttons = Array.from(item.querySelectorAll('button, [role="button"], input[type="button"]'));
    return buttons.some((btn) => {
      if (!visible(btn)) return false;
      const text = controlSignal(btn);
      return /\b(add file|upload file|choose file|browse files|attach file|select file|drop files here)\b/i.test(
        text,
      );
    });
  }

  function looksLikeDateField(item: Element): boolean {
    if (item.querySelector('input[type="date"], input[type="datetime-local"], input[type="month"], input[type="week"]')) {
      return true;
    }
    const month = item.querySelector('[aria-label*="Month" i], input[placeholder="MM"]');
    const day = item.querySelector('[aria-label*="Day" i], input[placeholder="DD"]');
    const year = item.querySelector('[aria-label*="Year" i], input[placeholder="YYYY"]');
    // Require a real date widget — not the word "year" in a radio or essay prompt.
    return Boolean(month && (day || year));
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

  const BATCH_ATTR = "data-1apply-batch-id";

  function captureFormPage(): CapturedFormPage {
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
      const label = (heading?.textContent ?? item.getAttribute("aria-label") ?? "")
        .replace(/\s+/g, " ")
        .replace(/\bYour answer\b/gi, " ")
        .replace(/\s*\*\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!label || label.length < 2) continue;

      const key = label.slice(0, 120);
      const fieldKey =
        key.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 80) || `field_${fields.length}`;
      const fieldId = stableFieldId(fieldKey, fieldKey, fieldKey);

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
        options = Array.from(item.querySelectorAll('[role="option"]'))
          .map((node) => (node.getAttribute("aria-label") ?? node.textContent ?? "").trim())
          .filter(Boolean);
      } else if (item.querySelector('input[type="file"]') || looksLikeFileField(item)) {
        type = "file";
      } else if (item.querySelector("textarea")) {
        type = "textarea";
      } else if (looksLikeDateField(item)) {
        type = "date";
      } else {
        const native = item.querySelector("input") as HTMLInputElement | null;
        // email/tel/search map to text via normalizeBatchFieldType
        type = normalizeBatchFieldType(native?.type || "text");
      }

      item.setAttribute(BATCH_ATTR, fieldId);
      if (seen.has(fieldId)) continue;
      seen.add(fieldId);
      const requiredMarker = Boolean(
        item.querySelector(
          '[aria-required="true"], .freebirdFormviewerComponentsQuestionBaseRequiredAsterisk',
        ),
      );
      const headingRequired = /\brequired\b/i.test(heading?.textContent ?? "");
      const looksOptional = /\boptional\b/i.test(item.textContent ?? "");
      const checkedChoice = item.querySelector(
        '[role="radio"][aria-checked="true"], [role="checkbox"][aria-checked="true"], input:checked',
      );
      const nativeValue = (
        item.querySelector("input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox]), textarea") as
          | HTMLInputElement
          | HTMLTextAreaElement
          | null
      )?.value;
      const currentValue =
        (checkedChoice
          ? (checkedChoice.getAttribute("aria-label") ?? checkedChoice.textContent ?? "").trim()
          : nativeValue?.trim()) || undefined;
      fields.push({
        fieldId,
        fieldKey,
        type: normalizeBatchFieldType(type),
        label,
        required: !looksOptional && (requiredMarker || headingRequired),
        options,
        currentValue,
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

  function headingText(item: Element): string {
    const heading = item.querySelector(
      '[role="heading"], .M7eMe, .freebirdFormviewerComponentsQuestionBaseTitle',
    );
    return (heading?.textContent ?? item.getAttribute("aria-label") ?? "")
      .replace(/\s+/g, " ")
      .replace(/\bYour answer\b/gi, " ")
      .replace(/\s*\*\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findByBatchId(fieldId: string): HTMLElement | null {
    return document.querySelector(`[data-1apply-batch-id="${fieldId}"]`) as HTMLElement | null;
  }

  function findCard(entry: FillPlanEntry): HTMLElement | null {
    const byId = findByBatchId(entry.fieldId);
    if (byId) return byId;
    const want = (entry.label ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    if (want.length < 2) return null;
    for (const item of Array.from(document.querySelectorAll('[role="listitem"]')) as HTMLElement[]) {
      const text = headingText(item).toLowerCase();
      if (!text) continue;
      if (text === want || text.includes(want) || want.includes(text)) {
        item.setAttribute(BATCH_ATTR, entry.fieldId);
        return item;
      }
    }
    return null;
  }

  function activateToggle(el: HTMLElement) {
    el.scrollIntoView?.({ block: "center", inline: "nearest" });
    el.focus?.();
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"] as const) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
    }
    el.click();
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true }),
    );
    el.dispatchEvent(
      new KeyboardEvent("keyup", { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true }),
    );
  }

  function isChecked(el: Element): boolean {
    const node = el as HTMLInputElement;
    return node.getAttribute("aria-checked") === "true" || Boolean(node.checked);
  }

  function choiceLabel(node: Element): string {
    const el = node as HTMLElement;
    const row =
      (el.closest("[data-value]") as HTMLElement | null) ||
      (el.closest(".nWQGrd, .docssharedWizToggleLabeledContainer") as HTMLElement | null) ||
      el;
    const rowLabel = row.querySelector(
      ".docssharedWizToggleLabeledLabelText, .ulDsOb, .aDTYNe, .Od2TWd",
    ) as HTMLElement | null;
    return [
      el.getAttribute("data-value") ?? "",
      el.getAttribute("aria-label") ?? "",
      el.textContent ?? "",
      row.getAttribute("data-value") ?? "",
      row.getAttribute("aria-label") ?? "",
      rowLabel?.textContent ?? "",
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function choiceMatches(label: string, value: string): boolean {
    const target = value.trim().toLowerCase();
    const text = label.trim().toLowerCase();
    if (!target || !text) return false;
    if (text === target) return true;
    const compactLabel = text.replace(/\s+/g, "");
    const compactTarget = target.replace(/\s+/g, "");
    if (compactLabel === compactTarget) return true;
    if (text.startsWith(target) || target.startsWith(text)) return true;
    return labelsMatch(label, value) && text.length <= target.length + 48;
  }

  function clickMatchingChoice(item: HTMLElement, selector: string, value: string): boolean {
    const nodes = Array.from(item.querySelectorAll(selector));
    for (const node of nodes) {
      if (!choiceMatches(choiceLabel(node), value)) continue;
      const el = node as HTMLElement;
      const row =
        (el.closest(".nWQGrd, .docssharedWizToggleLabeledContainer, [data-value]") as HTMLElement | null) || el;
      activateToggle(el);
      if (!isChecked(el) && !isChecked(row)) activateToggle(row);
      if (!isChecked(el) && !isChecked(row)) {
        const labelEl = row.querySelector(
          ".docssharedWizToggleLabeledLabelText, .ulDsOb, .aDTYNe, .Od2TWd",
        ) as HTMLElement | null;
        if (labelEl) activateToggle(labelEl);
      }
      return isChecked(el) || isChecked(row) || true;
    }
    return false;
  }

  function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
    // Mirror extension content script — Google Forms ignores bare Event("input").
    el.focus();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    if (el.value !== value) el.value = value;
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: "insertFromPaste",
        data: value,
      }),
    );
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    el.blur();
  }

  function applyField(item: HTMLElement, entry: FillPlanEntry): boolean {
    if (entry.status !== "filled") return false;
    const type = entry.type ?? "text";
    const value = entry.value?.trim() ?? "";
    const looksLikeUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    if (entry.documentVersionId || (type === "file" && (!value || looksLikeUuid))) return false;
    if (!value) return false;

    if (type === "radio" || item.querySelector('[role="radio"]')) {
      return clickMatchingChoice(item, '[role="radio"], input[type="radio"]', value);
    }

    if (type === "checkbox" || item.querySelector('[role="checkbox"]')) {
      const wanted = value
        .split(/\n|;/)
        .map((part) => part.trim())
        .filter(Boolean);
      let changed = false;
      for (const part of wanted.length ? wanted : [value]) {
        if (clickMatchingChoice(item, '[role="checkbox"], input[type="checkbox"]', part)) {
          changed = true;
        }
      }
      return changed;
    }

    if (type === "select" || item.querySelector('[role="listbox"]')) {
      const listbox = item.querySelector('[role="listbox"]') as HTMLElement | null;
      if (listbox) {
        activateToggle(listbox);
        const options = Array.from(document.querySelectorAll('[role="option"], [role="menuitemradio"]'));
        for (const opt of options) {
          if (choiceMatches(choiceLabel(opt), value) || labelsMatch(controlSignal(opt), value)) {
            activateToggle(opt as HTMLElement);
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
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: "insertFromPaste",
          data: value,
        }),
      );
      editable.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      editable.blur();
      return Boolean((editable.textContent ?? "").trim());
    }

    return false;
  }

  function applyFillPlan(entries: FillPlanEntry[]): { filled: number; skipped: number; details: Array<{ fieldId: string; ok: boolean }> } {
    let filled = 0;
    let skipped = 0;
    const details: Array<{ fieldId: string; ok: boolean }> = [];
    for (const entry of entries) {
      const item = findCard(entry);
      if (!item || entry.status !== "filled") {
        skipped += 1;
        details.push({ fieldId: entry.fieldId, ok: false });
        continue;
      }
      const ok = applyField(item, entry);
      if (ok) filled += 1;
      else skipped += 1;
      details.push({ fieldId: entry.fieldId, ok });
    }
    return { filled, skipped, details };
  }

  function readFilledValues(entries: FillPlanEntry[]): Array<{ fieldId: string; value: string; empty: boolean }> {
    return entries.map((entry) => {
      const item = findCard(entry);
      if (!item) return { fieldId: entry.fieldId, value: "", empty: true };
      const input = item.querySelector(
        'input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox]), textarea, [contenteditable="true"], [role="textbox"]',
      ) as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
      if (!input) {
        const checked = item.querySelector('[aria-checked="true"], input:checked');
        return { fieldId: entry.fieldId, value: checked ? "checked" : "", empty: !checked };
      }
      const value =
        input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement
          ? input.value
          : (input.textContent ?? "");
      const trimmed = value.trim();
      return { fieldId: entry.fieldId, value: trimmed, empty: !trimmed };
    });
  }

  function clickFormControl(kind: "next" | "submit"): { clicked: boolean; reason?: string } {
    const buttons = Array.from(
      document.querySelectorAll(
        'button, [role="button"], input[type="submit"], input[type="button"], span[role="link"]',
      ),
    ) as HTMLElement[];
    const matches = buttons.filter((btn) => classifyButton(btn) === kind && visible(btn));
    // Prefer explicit Submit/Send wording; avoid loose "done"/"complete" matches first.
    let preferred =
      matches.find((btn) => {
        const signal = controlSignal(btn);
        return kind === "next"
          ? /\b(next|continue|proceed|forward|go\s*next|next\s*page|next\s*step|weiter|siguiente|suivant)\b/i.test(
              signal,
            )
          : /\b(submit|send response|submit response|send form|absenden|enviar|envoyer)\b/i.test(signal);
      }) ??
      matches.find((btn) => {
        const signal = controlSignal(btn);
        return kind === "submit"
          ? /\b(submit|send|finish|apply)\b/i.test(signal)
          : true;
      }) ??
      matches[matches.length - 1];

    if (!preferred && kind === "submit") {
      const googleSubmit = document.querySelector(
        '.freebirdFormviewerViewNavigationSubmitButton, [jsname="M2UYVd"], [data-action-id="submit"]',
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
    const href = location.href.toLowerCase();
    // Google Forms confirmation heading / message
    if (/your response has been recorded|response has been recorded|response recorded|تم تسجيل إجابتك/i.test(text)) {
      return true;
    }
    if (/formresponse/.test(href) && !/viewform|editform/.test(href)) return true;
    return /thank you for (your )?(response|submission)|submission received|successfully submitted|application received|we have received your|تم إرسال/i.test(
      text,
    );
  }

  function detectRequiredFieldErrors(): boolean {
    const text = (document.body?.innerText ?? "").toLowerCase();
    return /this is a required question|required question|please fill out this field|please enter a|must be filled|is required\b/i.test(
      text,
    );
  }

  if (action === "capture") return captureFormPage();
  if (action === "apply") return applyFillPlan(arg ?? []);
  if (action === "read") return readFilledValues(arg ?? []);
  if (action === "next") return clickNextControl();
  if (action === "submit") return clickSubmitControl();
  if (action === "confirm") return detectSubmissionConfirmation();
  if (action === "validation") return detectRequiredFieldErrors();
  throw new Error("unknown_form_dom_action");
}
