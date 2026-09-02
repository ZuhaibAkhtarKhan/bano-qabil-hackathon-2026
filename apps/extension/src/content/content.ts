import {
  APPLY_BATCH_ID_ATTR,
  APPLY_EMPTY_ATTR,
  APPLY_FIELD_ATTR,
  APPLY_HOST_ATTR,
  assertFillActionAllowed,
  describeFieldLengthLimit,
  detectFieldLengthLimit,
  fieldsEligibleForBatch,
  fillTargetAllowed,
  findPrimaryStepAdvance,
  findPrimarySubmitControl,
  inspectPage,
  inventoryFromDocument,
  isProtectedControl,
  isSensitiveField,
  isStepAdvanceControl,
  stampBatchFieldIds,
  toBatchFieldInputs,
  toHtmlDateValue,
  valueFitsNativeInput,
  type FieldLengthLimit,
} from "@1apply/form-engine";

type FillOption = { value: string; label?: string; source?: string };

type AttachedFile = {
  versionId: string;
  filename: string;
  mimeType: string;
  base64: string;
};

type FillPayload = {
  fieldKey: string;
  label?: string;
  value: string;
  type: string;
  options?: FillOption[];
  showChip?: boolean;
  aiAnswerable?: boolean;
  file?: AttachedFile | null;
};

const WIDGET_ATTR = "data-1apply-chip";
const HIGHLIGHT_STYLE_ID = "oneapply-highlight-style";
const TOAST_ATTR = "data-1apply-toast";

const root = globalThis as {
  __1APPLY_LISTENERS?: boolean;
  __1APPLY_PAGE_WATCH?: boolean;
  __1APPLY_LAST_PAGE_FP?: string;
  __1APPLY_AUTO_CONTINUE?: boolean;
  __1APPLY_FILLING?: boolean;
  __1APPLY_CONTINUE_TIMER?: number | null;
  __1APPLY_CONTINUE_TRIES?: number;
  __1APPLY_ADVANCE_LOCK?: boolean;
  __1APPLY_STEPS?: number;
  /** Hard stop — ignores late APPLY / Next until the user fills again. */
  __1APPLY_STOPPED?: boolean;
  /** When true, auto-click host Submit on the final page (deadline automation). */
  __1APPLY_AUTO_SUBMIT_HOST?: boolean;
  __1APPLY_PENDING_TIMERS?: number[];
};
if (!root.__1APPLY_LISTENERS) {
  root.__1APPLY_LISTENERS = true;
  root.__1APPLY_CONTINUE_TIMER = null;
  root.__1APPLY_CONTINUE_TRIES = 0;
  root.__1APPLY_PENDING_TIMERS = [];
  root.__1APPLY_STOPPED = false;

  function clearPendingTimers() {
    if (root.__1APPLY_CONTINUE_TIMER) {
      window.clearTimeout(root.__1APPLY_CONTINUE_TIMER);
      root.__1APPLY_CONTINUE_TIMER = null;
    }
    for (const id of root.__1APPLY_PENDING_TIMERS ?? []) {
      window.clearTimeout(id);
    }
    root.__1APPLY_PENDING_TIMERS = [];
  }

  function trackTimeout(handler: () => void, delay: number) {
    const id = window.setTimeout(() => {
      root.__1APPLY_PENDING_TIMERS = (root.__1APPLY_PENDING_TIMERS ?? []).filter((item) => item !== id);
      handler();
    }, delay);
    root.__1APPLY_PENDING_TIMERS = [...(root.__1APPLY_PENDING_TIMERS ?? []), id];
    return id;
  }

  function isFillActive() {
    return Boolean(root.__1APPLY_AUTO_CONTINUE) && !root.__1APPLY_STOPPED;
  }

  function pageFingerprint(): string {
    const urlKey = `${location.origin}${location.pathname}?${location.search}#${location.hash}`;
    const fields = inventoryFromDocument(document);
    const fieldKey = fields
      .map((field) => `${field.type}|${(field.label || field.name || field.key).slice(0, 120)}`)
      .sort()
      .join("\n");
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"], legend'))
      .slice(0, 16)
      .map((el) => (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80))
      .filter(Boolean)
      .join("|");
    const visibleControls = Array.from(
      document.querySelectorAll(
        'input:not([type=hidden]), textarea, select, [role="textbox"], [role="listbox"], [role="radio"], [role="checkbox"], [contenteditable="true"]',
      ),
    ).filter((el) => {
      const node = el as HTMLElement;
      if (!node.getBoundingClientRect) return true;
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    }).length;
    return [urlKey, `visible=${visibleControls}`, headings, fieldKey].join("\n---\n");
  }

  function showToast(text: string) {
    document.querySelector(`[${TOAST_ATTR}]`)?.remove();
    const toast = document.createElement("div");
    toast.setAttribute(TOAST_ATTR, "1");
    toast.textContent = text;
    toast.style.cssText =
      "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:280px;padding:12px 14px;border-radius:14px;background:#0e0e0e;color:#fff;font:600 12px/1.4 system-ui,sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.24);";
    document.documentElement.append(toast);
    window.setTimeout(() => toast.remove(), 3200);
  }

  function requestAutoContinue(force = false) {
    if (!isFillActive() || root.__1APPLY_FILLING) return;
    const fp = pageFingerprint();
    if (!fp) return;
    if (!force && fp === root.__1APPLY_LAST_PAGE_FP) return;

    const pendingFp = fp;
    chrome.runtime.sendMessage({ type: "AUTO_CONTINUE_FILL", url: location.href, fingerprint: pendingFp }, (response) => {
      if (!isFillActive()) return;
      if (chrome.runtime.lastError) {
        // Service worker may be waking — retry without locking the fingerprint.
        root.__1APPLY_CONTINUE_TRIES = (root.__1APPLY_CONTINUE_TRIES ?? 0) + 1;
        if ((root.__1APPLY_CONTINUE_TRIES ?? 0) <= 4) {
          trackTimeout(() => requestAutoContinue(true), 700 * (root.__1APPLY_CONTINUE_TRIES ?? 1));
        }
        return;
      }

      const ok = Boolean(response && typeof response === "object" && (response as { ok?: boolean }).ok);
      const reason = response && typeof response === "object" ? String((response as { reason?: string }).reason ?? "") : "";

      if (ok) {
        root.__1APPLY_LAST_PAGE_FP = pageFingerprint();
        root.__1APPLY_CONTINUE_TRIES = 0;
        const filled = Number((response as { filled?: number }).filled ?? 0);
        showToast(filled ? `1-Apply filled ${filled} field(s) on this step.` : "1-Apply ready on this step.");
        // Next-page advance is scheduled from APPLY_SUGGESTIONS after this fill completes.
        return;
      }

      // Page not ready yet (common right after Next) — retry a few times.
      if (reason === "no-fields" || reason === "busy" || reason.includes("bad-tab") || reason.includes("Receiving end")) {
        root.__1APPLY_CONTINUE_TRIES = (root.__1APPLY_CONTINUE_TRIES ?? 0) + 1;
        if ((root.__1APPLY_CONTINUE_TRIES ?? 0) <= 6) {
          trackTimeout(() => requestAutoContinue(true), 600 + 400 * (root.__1APPLY_CONTINUE_TRIES ?? 1));
        }
        return;
      }

      // Hard failures (no session / origin mismatch / stopped) — stop quietly.
      if (reason === "no-session" || reason === "origin-mismatch" || reason === "stopped") {
        root.__1APPLY_AUTO_CONTINUE = false;
        root.__1APPLY_STOPPED = true;
        clearPendingTimers();
      }
    });
  }

  function isStepAdvanceControlLocal(el: Element | null): boolean {
    return isStepAdvanceControl(el);
  }

  async function tryAutoAdvance(): Promise<{ clicked: boolean; reason?: string }> {
    if (!isFillActive()) return { clicked: false, reason: "stopped" };
    if (root.__1APPLY_FILLING) return { clicked: false, reason: "busy" };
    if (root.__1APPLY_ADVANCE_LOCK) return { clicked: false, reason: "locked" };

    const steps = root.__1APPLY_STEPS ?? 0;
    if (steps >= 12) {
      showToast("1-Apply stopped after 12 pages — review and Stop when done.");
      return { clicked: false, reason: "max-steps" };
    }

    const empty = document.querySelectorAll(`[${APPLY_EMPTY_ATTR}]`).length;
    if (empty > 0) {
      return { clicked: false, reason: "empty-fields" };
    }

    const btn = findPrimaryStepAdvance(document);
    if (!btn) {
      if (root.__1APPLY_AUTO_SUBMIT_HOST) {
        return tryAutoSubmit();
      }
      showToast("1-Apply finished fillable pages. Missing answers stay in Need You — Stop when done.");
      return { clicked: false, reason: "no-next" };
    }

    root.__1APPLY_ADVANCE_LOCK = true;
    try {
      if (!isFillActive()) return { clicked: false, reason: "stopped" };
      assertFillActionAllowed("clickNext");
      const before = pageFingerprint();
      root.__1APPLY_LAST_PAGE_FP = undefined;
      root.__1APPLY_CONTINUE_TRIES = 0;
      root.__1APPLY_STEPS = steps + 1;

      btn.scrollIntoView({ block: "center", inline: "nearest" });
      await sleep(80);
      if (!isFillActive()) return { clicked: false, reason: "stopped" };
      btn.click();
      showToast("1-Apply opened the next page…");

      // Wait for SPA / Google Forms paint; if fingerprint unchanged, host may have blocked Next.
      await sleep(1400);
      if (!isFillActive()) return { clicked: false, reason: "stopped" };
      const after = pageFingerprint();
      if (after && before && after === before) {
        // Stay on this step; lock fingerprint so we don't thrash fill → Next.
        root.__1APPLY_LAST_PAGE_FP = after;
        showToast("Next page blocked — fill highlighted fields or answer in Need You.");
        return { clicked: true, reason: "no-change" };
      }

      trackTimeout(() => requestAutoContinue(true), 400);
      trackTimeout(() => requestAutoContinue(true), 1600);
      trackTimeout(() => requestAutoContinue(true), 3200);
      return { clicked: true };
    } finally {
      // Release promptly so the next page’s fill can schedule another advance.
      root.__1APPLY_ADVANCE_LOCK = false;
    }
  }

  async function tryAutoSubmit(): Promise<{ clicked: boolean; submitted?: boolean; reason?: string; blockedReason?: string }> {
    if (!isFillActive()) return { clicked: false, reason: "stopped" };
    if (root.__1APPLY_FILLING) return { clicked: false, reason: "busy" };

    const hazards = inspectPage(document, document.body?.innerText ?? "", inventoryFromDocument(document));
    if (hazards.captcha) {
      return { clicked: false, blockedReason: "CAPTCHA on this page — complete it manually." };
    }
    if (hazards.accountCreation) {
      return { clicked: false, blockedReason: "Account creation required — sign in manually." };
    }

    const empty = document.querySelectorAll(`[${APPLY_EMPTY_ATTR}]`).length;
    if (empty > 0) {
      return { clicked: false, reason: "empty-fields" };
    }

    const btn = findPrimarySubmitControl(document);
    if (!btn) {
      return { clicked: false, reason: "no-submit" };
    }

    try {
      assertFillActionAllowed("clickSubmit", { hostSubmitAllowed: true });
      btn.scrollIntoView({ block: "center", inline: "nearest" });
      await sleep(120);
      btn.click();
      showToast("1-Apply clicked Submit…");
      await sleep(2500);
      const bodyText = (document.body?.innerText ?? "").toLowerCase();
      const submitted =
        /response recorded|thank you|submission received|your response has been recorded|تم إرسال/i.test(bodyText) ||
        /forms\.gle|google\.com\/forms.*\/viewform/i.test(location.href) === false;
      return { clicked: true, submitted };
    } catch (error) {
      return {
        clicked: false,
        reason: error instanceof Error ? error.message : "submit-failed",
      };
    }
  }

  function scheduleAutoContinue(delay = 800, force = false) {
    if (!isFillActive() || root.__1APPLY_FILLING) return;
    if (root.__1APPLY_CONTINUE_TIMER) window.clearTimeout(root.__1APPLY_CONTINUE_TIMER);
    root.__1APPLY_CONTINUE_TIMER = window.setTimeout(() => {
      root.__1APPLY_CONTINUE_TIMER = null;
      requestAutoContinue(force);
    }, delay);
  }

  function enableAutoContinueWatch() {
    if (root.__1APPLY_STOPPED) return;
    const wasActive = root.__1APPLY_AUTO_CONTINUE;
    root.__1APPLY_AUTO_CONTINUE = true;
    if (!wasActive) root.__1APPLY_STEPS = 0;
    if (root.__1APPLY_PAGE_WATCH) return;
    root.__1APPLY_PAGE_WATCH = true;

    const observer = new MutationObserver(() => scheduleAutoContinue(1000));
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style", "hidden", "aria-hidden", "aria-checked", "data-value"],
      });
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "style", "hidden", "aria-hidden", "aria-checked", "data-value"],
        });
      });
    }

    document.addEventListener(
      "click",
      (event) => {
        if (!isFillActive()) return;
        if (isStepAdvanceControlLocal(event.target as Element | null)) {
          // Invalidate current fingerprint so the next step is always attempted.
          root.__1APPLY_LAST_PAGE_FP = undefined;
          root.__1APPLY_CONTINUE_TRIES = 0;
          trackTimeout(() => requestAutoContinue(true), 1200);
          trackTimeout(() => requestAutoContinue(true), 2500);
          trackTimeout(() => requestAutoContinue(true), 4500);
        }
      },
      true,
    );

    document.addEventListener(
      "submit",
      () => {
        if (!isFillActive()) return;
        root.__1APPLY_LAST_PAGE_FP = undefined;
        trackTimeout(() => requestAutoContinue(true), 1200);
        trackTimeout(() => requestAutoContinue(true), 2800);
      },
      true,
    );
    window.addEventListener("popstate", () => {
      if (!isFillActive()) return;
      root.__1APPLY_LAST_PAGE_FP = undefined;
      scheduleAutoContinue(700, true);
    });
    window.addEventListener("hashchange", () => {
      if (!isFillActive()) return;
      root.__1APPLY_LAST_PAGE_FP = undefined;
      scheduleAutoContinue(700, true);
    });

    const wrapHistory = (method: "pushState" | "replaceState") => {
      const original = history[method].bind(history);
      history[method] = ((...args: Parameters<History["pushState"]>) => {
        const result = original(...args);
        if (isFillActive()) {
          root.__1APPLY_LAST_PAGE_FP = undefined;
          scheduleAutoContinue(800, true);
        }
        return result;
      }) as History["pushState"];
    };
    wrapHistory("pushState");
    wrapHistory("replaceState");
  }

  function disableAutoContinueWatch() {
    root.__1APPLY_STOPPED = true;
    root.__1APPLY_AUTO_CONTINUE = false;
    root.__1APPLY_LAST_PAGE_FP = undefined;
    root.__1APPLY_CONTINUE_TRIES = 0;
    root.__1APPLY_STEPS = 0;
    root.__1APPLY_ADVANCE_LOCK = false;
    clearPendingTimers();
  }

  // If a fill session is already active for this origin, resume watching after reinjection / reload.
  void chrome.storage.local.get(["fillSession"]).then((data) => {
    const session = data.fillSession as { enabled?: boolean; origin?: string } | undefined;
    if (!session?.enabled || session.origin !== location.origin) return;
    if (root.__1APPLY_STOPPED) return;
    enableAutoContinueWatch();
    scheduleAutoContinue(900, true);
  });

  function cssEscape(value: string): string {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
    return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function findTagged(fieldKey: string): Element | null {
    return document.querySelector(`[${APPLY_FIELD_ATTR}="${cssEscape(fieldKey)}"]`);
  }

  function findCard(fieldKey: string): HTMLElement | null {
    const tagged = findTagged(fieldKey);
    if (!tagged) return null;
    return (tagged.closest(`[${APPLY_HOST_ATTR}]`) as HTMLElement | null) || (tagged.closest('[role="listitem"]') as HTMLElement | null) || (tagged as HTMLElement);
  }

  function findControl(fieldKey: string): HTMLElement | null {
    const nodes = Array.from(document.querySelectorAll(`[${APPLY_FIELD_ATTR}="${cssEscape(fieldKey)}"]`)) as HTMLElement[];
    const control = nodes.find(
      (node) =>
        node instanceof HTMLInputElement ||
        node instanceof HTMLTextAreaElement ||
        node instanceof HTMLSelectElement ||
        node.getAttribute("contenteditable") === "true" ||
        node.getAttribute("role") === "textbox" ||
        node.getAttribute("role") === "listbox" ||
        node.getAttribute("role") === "combobox" ||
        node.getAttribute("role") === "radio" ||
        node.getAttribute("role") === "checkbox",
    );
    if (control) return control;
    if (nodes[0]) return nodes[0];
    return (
      document.querySelector<HTMLElement>(`[name="${cssEscape(fieldKey)}"]`) ||
      document.querySelector<HTMLElement>(`#${cssEscape(fieldKey)}`)
    );
  }

  function findControlByBatchId(fieldId: string): HTMLElement | null {
    const tagged = document.querySelector(`[${APPLY_BATCH_ID_ATTR}="${cssEscape(fieldId)}"]`) as HTMLElement | null;
    if (!tagged) return null;
    const key = tagged.getAttribute(APPLY_FIELD_ATTR);
    if (key) return findControl(key) || tagged;
    return tagged;
  }

  function readControlValue(fieldKey: string, fieldType: string): string {
    const el = findControl(fieldKey);
    if (!el) return "";

    if (fieldType === "radio" || (el instanceof HTMLInputElement && el.type === "radio")) {
      const radios = Array.from(
        document.querySelectorAll<HTMLInputElement>(`input[type="radio"][${APPLY_FIELD_ATTR}="${cssEscape(fieldKey)}"]`),
      );
      const checked = radios.find((item) => item.checked) ?? (el instanceof HTMLInputElement && el.checked ? el : null);
      if (!checked) return "";
      return (
        checked.value ||
        checked.getAttribute("aria-label") ||
        checked.labels?.[0]?.textContent ||
        ""
      )
        .trim()
        .replace(/\s+/g, " ");
    }

    if (fieldType === "checkbox" || (el instanceof HTMLInputElement && el.type === "checkbox")) {
      const boxes = Array.from(
        document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][${APPLY_FIELD_ATTR}="${cssEscape(fieldKey)}"]`),
      );
      const checked = (boxes.length ? boxes : el instanceof HTMLInputElement ? [el] : []).filter((item) => item.checked);
      return checked
        .map((item) => (item.value && item.value !== "on" ? item.value : item.labels?.[0]?.textContent || "true"))
        .map((value) => value.trim().replace(/\s+/g, " "))
        .filter(Boolean)
        .join(", ");
    }

    if (el instanceof HTMLSelectElement) {
      return Array.from(el.selectedOptions)
        .map((option) => option.textContent?.trim() || option.value)
        .filter(Boolean)
        .join(", ");
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el instanceof HTMLInputElement && el.type === "file") {
        return Array.from(el.files ?? [])
          .map((file) => file.name)
          .join(", ");
      }
      return el.value.trim();
    }

    if (el.isContentEditable || el.getAttribute("role") === "textbox") {
      return (el.textContent ?? "").trim().replace(/\s+/g, " ");
    }

    const listbox = el.getAttribute("role") === "listbox" ? el : el.querySelector('[role="option"][aria-selected="true"]');
    if (listbox) {
      const selected = el.querySelectorAll('[role="option"][aria-selected="true"]');
      if (selected.length) {
        return Array.from(selected)
          .map((node) => (node.textContent ?? "").trim().replace(/\s+/g, " "))
          .filter(Boolean)
          .join(", ");
      }
    }

    return "";
  }

  function optionText(node: Element): string {
    return (
      node.getAttribute("aria-label") ||
      node.getAttribute("data-value") ||
      node.querySelector("span")?.textContent ||
      node.textContent ||
      ""
    )
      .trim()
      .replace(/\s+/g, " ");
  }

  function setNativeTextValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
    el.focus();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    descriptor?.set?.call(el, value);
    if (el.value !== value) el.value = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, composed: true, inputType: "insertFromPaste", data: value }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    el.blur();
  }

  function base64ToFile(file: AttachedFile): File {
    const binary = atob(file.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], file.filename || "document.pdf", {
      type: file.mimeType || "application/pdf",
      lastModified: Date.now(),
    });
  }

  function normalizeFilename(name: string): string {
    return name.trim().toLowerCase().replace(/^.*[\\/]/, "");
  }

  function filenamesMatch(a: string, b: string): boolean {
    const left = normalizeFilename(a);
    const right = normalizeFilename(b);
    if (!left || !right) return false;
    if (left === right) return true;
    // Allow stem match when extensions differ (resume.pdf vs resume.docx) only if both include a clear stem ≥ 4 chars.
    const stem = (value: string) => value.replace(/\.[a-z0-9]{1,8}$/i, "");
    const leftStem = stem(left);
    const rightStem = stem(right);
    return Boolean(leftStem.length >= 4 && leftStem === rightStem);
  }

  /** True when this file question already has the same (or any matching) document attached. */
  function fileAlreadyUploaded(scope: ParentNode, filename?: string): boolean {
    const wanted = filename ? normalizeFilename(filename) : "";
    const inputs = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    for (const input of inputs) {
      const files = Array.from(input.files ?? []);
      if (!files.length) continue;
      if (!wanted) return true;
      if (files.some((item) => filenamesMatch(item.name, wanted))) return true;
    }

    const blob = (scope.textContent ?? "").replace(/\s+/g, " ");
    if (wanted && blob.toLowerCase().includes(wanted)) {
      if (/uploaded|selected|attached|remove file|replace file|\.pdf|\.docx?/i.test(blob)) return true;
    }
    // Google Forms / ATS chips often show the name next to a remove control without exposing input.files.
    if (wanted) {
      const named = Array.from(scope.querySelectorAll("a, span, div, li, [role='listitem'], [data-tooltip]")).some((node) => {
        const text = (node.textContent ?? node.getAttribute("data-tooltip") ?? "").trim();
        return filenamesMatch(text, wanted) || normalizeFilename(text).endsWith(wanted);
      });
      if (named && /remove|uploaded|file|pdf|docx?/i.test(blob)) return true;
    }
    return false;
  }

  function applyFile(el: HTMLInputElement, file: AttachedFile): boolean {
    if (fileAlreadyUploaded(el.form ?? el.parentElement ?? document, file.filename) || fileAlreadyUploaded(el, file.filename)) {
      return true;
    }
    if (!file.base64) return false;
    const transfer = new DataTransfer();
    transfer.items.add(base64ToFile(file));
    el.files = transfer.files;
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return (el.files?.length ?? 0) > 0;
  }

  async function resolveFile(mapping: FillPayload): Promise<AttachedFile | null> {
    if (mapping.file?.base64) return mapping.file;
    const versionId = mapping.file?.versionId || mapping.value;
    if (!versionId) return null;
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "FETCH_DOCUMENT", versionId }, (response) => {
        const payload = response as
          | { error?: string; versionId?: string; filename?: string; mimeType?: string; base64?: string }
          | undefined;
        if (chrome.runtime.lastError || !payload || payload.error || !payload.base64) {
          resolve(null);
          return;
        }
        resolve({
          versionId: String(payload.versionId ?? versionId),
          filename: String(payload.filename ?? "document.pdf"),
          mimeType: String(payload.mimeType ?? "application/pdf"),
          base64: String(payload.base64),
        });
      });
    });
  }

  async function applyListbox(card: HTMLElement, value: string): Promise<boolean> {
    const listbox =
      (card.matches('[role="listbox"]') ? card : null) ||
      card.querySelector<HTMLElement>('[role="listbox"]') ||
      (findTagged(card.getAttribute(APPLY_FIELD_ATTR) || "") as HTMLElement | null);
    if (!listbox) return false;
    listbox.click();
    await sleep(250);
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
    const target = value.trim().toLowerCase();
    const match =
      options.find((option) => optionText(option).toLowerCase() === target) ||
      options.find((option) => {
        const text = optionText(option).toLowerCase();
        return text.includes(target) || target.includes(text);
      }) ||
      options.find((option) => {
        const text = optionText(option).toLowerCase();
        if (target.includes("delhi") && text.includes("delhi")) return true;
        const tTokens = target.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
        return tTokens.some((token) => text.includes(token));
      });
    if (!match) {
      listbox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return false;
    }
    match.click();
    await sleep(100);
    return true;
  }

  async function applyRoleRadios(card: HTMLElement, value: string): Promise<boolean> {
    const radios = Array.from(card.querySelectorAll<HTMLElement>('[role="radio"]'));
    const target = value.trim().toLowerCase();
    const compact = target.replace(/\s+/g, "");
    const match =
      radios.find((radio) => optionText(radio).toLowerCase() === target) ||
      radios.find((radio) => {
        const text = optionText(radio).toLowerCase();
        return text === compact || text.includes(target) || target.includes(text);
      }) ||
      radios.find((radio) => {
        const text = optionText(radio).toLowerCase().replace(/\s+/g, "");
        // "3rd year" ↔ "3rd"
        return text.length >= 2 && (compact.startsWith(text) || text.startsWith(compact.replace(/year$/, "")));
      });
    if (!match) return false;
    match.click();
    return true;
  }

  function isTruthyCheckValue(value: string): boolean {
    return /^(true|yes|1|checked|on|confirm)$/i.test(value.trim());
  }

  function activateToggle(el: HTMLElement) {
    el.focus?.();
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"] as const) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
    }
    el.click();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true }));
  }

  function isToggleChecked(el: HTMLElement): boolean {
    if (el instanceof HTMLInputElement) return el.checked;
    return el.getAttribute("aria-checked") === "true";
  }

  async function applyRoleChecks(card: HTMLElement, value: string): Promise<boolean> {
    let boxes = Array.from(card.querySelectorAll<HTMLElement>('[role="checkbox"]'));
    if (!boxes.length) {
      // Google Forms email/consent rows sometimes put role on an inner node we missed; find by copy.
      boxes = Array.from(document.querySelectorAll<HTMLElement>('[role="checkbox"]')).filter((node) => {
        const text = `${node.getAttribute("aria-label") ?? ""} ${node.textContent ?? ""}`;
        return /record\s+.+\s+as the email|privacy policy|i agree|i accept/i.test(text) || card.contains(node);
      });
    }
    const wanted = value
      .split(/\n|;/)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);
    const soleConfirm = boxes.length === 1 && (isTruthyCheckValue(value) || wanted.length > 0);
    let changed = false;
    for (const box of boxes) {
      const label = optionText(box).toLowerCase();
      const should =
        soleConfirm ||
        wanted.some((item) => label === item || label.includes(item) || item.includes(label)) ||
        /record\s+.+\s+as the email to be included/i.test(label);
      if (should === isToggleChecked(box)) continue;
      const targets = [box, box.parentElement, box.closest('[role="listitem"]')?.querySelector('[role="checkbox"]')].filter(
        (node): node is HTMLElement => Boolean(node),
      );
      for (const target of targets) {
        activateToggle(target);
        await sleep(40);
        if (isToggleChecked(box) || isToggleChecked(target)) {
          changed = true;
          break;
        }
      }
      if (!isToggleChecked(box)) {
        activateToggle(box);
        changed = true;
      }
    }
    await sleep(80);
    return changed || boxes.some((box) => isToggleChecked(box));
  }

  async function applyGoogleFile(card: HTMLElement, file: AttachedFile): Promise<boolean> {
    if (fileAlreadyUploaded(card, file.filename) || fileAlreadyUploaded(document, file.filename)) {
      return true;
    }

    const existing = card.querySelector<HTMLInputElement>('input[type="file"]') || document.querySelector<HTMLInputElement>('input[type="file"]');
    if (existing && applyFile(existing, file)) return true;

    const addBtn = Array.from(card.querySelectorAll<HTMLElement>('[role="button"], button')).find((node) =>
      /add file|upload file|browse/i.test(`${node.getAttribute("aria-label") ?? ""} ${node.textContent ?? ""}`),
    );
    if (addBtn) {
      addBtn.click();
      await sleep(600);
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (fileAlreadyUploaded(card, file.filename) || fileAlreadyUploaded(document, file.filename)) return true;
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
      for (const input of inputs) {
        if (applyFile(input, file)) return true;
      }
      // Ask background to try all frames (Google picker iframe).
      const ok = await new Promise<boolean>((resolve) => {
        chrome.runtime.sendMessage({ type: "ATTACH_FILE_ALL_FRAMES", file }, (response) => {
          resolve(Boolean(response && (response as { ok?: boolean }).ok));
        });
      });
      if (ok) return true;
      await sleep(350);
    }
    return false;
  }

  function valueForNativeInput(el: HTMLInputElement | HTMLTextAreaElement, value: string): string | null {
    if (!(el instanceof HTMLInputElement)) return value;
    const type = (el.type || "text").toLowerCase();
    if (type === "date") return toHtmlDateValue(value);
    if (["datetime-local", "month", "week", "time", "number", "range", "email", "url", "tel"].includes(type)) {
      return valueFitsNativeInput(value, type) ? value : null;
    }
    return value;
  }

  async function applyValue(el: HTMLElement, mapping: FillPayload): Promise<boolean> {
    const card = findCard(mapping.fieldKey) || el;

    if (mapping.type === "file") {
      const cardScope = findCard(mapping.fieldKey) || el;
      const knownName = mapping.file?.filename || mapping.options?.[0]?.label || "";
      if (fileAlreadyUploaded(cardScope, knownName) || fileAlreadyUploaded(document, knownName)) {
        return true;
      }
      const file = await resolveFile(mapping);
      if (!file) return false;
      if (fileAlreadyUploaded(cardScope, file.filename) || fileAlreadyUploaded(document, file.filename)) {
        return true;
      }
      if (el instanceof HTMLInputElement && el.type === "file") return applyFile(el, file);
      return applyGoogleFile(card, file);
    }

    if (mapping.type === "select" || mapping.type === "multi-select") {
      if (el instanceof HTMLSelectElement) {
        const match =
          Array.from(el.options).find((option) => option.value === mapping.value) ||
          Array.from(el.options).find((option) => option.textContent?.trim() === mapping.value) ||
          Array.from(el.options).find((option) => (option.textContent ?? "").toLowerCase().includes(mapping.value.toLowerCase()));
        if (!match) return false;
        el.value = match.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return applyListbox(card, mapping.value);
    }

    if (mapping.type === "radio") {
      if (card.querySelector('[role="radio"]')) return applyRoleRadios(card, mapping.value);
      const nodes = Array.from(
        document.querySelectorAll<HTMLInputElement>(`input[type="radio"][${APPLY_FIELD_ATTR}="${cssEscape(mapping.fieldKey)}"]`),
      );
      const target = mapping.value.trim().toLowerCase();
      for (const node of nodes) {
        const label = `${node.getAttribute("aria-label") ?? ""} ${node.labels?.[0]?.textContent ?? ""} ${node.value}`.toLowerCase();
        if (label.includes(target) || target.includes(node.value.toLowerCase())) {
          if (!node.checked) node.click();
          return true;
        }
      }
      return false;
    }

    if (mapping.type === "checkbox") {
      if (card.querySelector('[role="checkbox"]')) return applyRoleChecks(card, mapping.value);
      const nodes = Array.from(
        document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][${APPLY_FIELD_ATTR}="${cssEscape(mapping.fieldKey)}"]`),
      );
      const wanted = mapping.value
        .split(/\n|;/)
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);
      const soleConfirm = nodes.length === 1 && (isTruthyCheckValue(mapping.value) || wanted.length > 0);
      let changed = false;
      for (const node of nodes) {
        const label = `${node.getAttribute("aria-label") ?? ""} ${node.labels?.[0]?.textContent ?? ""} ${node.value}`.toLowerCase();
        const should =
          soleConfirm ||
          wanted.some((item) => label.includes(item) || item.includes(node.value.toLowerCase()));
        if (node.checked !== should) {
          node.click();
          changed = true;
        }
      }
      return changed || nodes.some((node) => node.checked);
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const next = valueForNativeInput(el, mapping.value);
      if (next == null) return false;
      setNativeTextValue(el, next);
      return true;
    }

    const textInput = card.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox]), textarea",
    );
    if (textInput) {
      const next = valueForNativeInput(textInput, mapping.value);
      if (next == null) return false;
      setNativeTextValue(textInput, next);
      return true;
    }

    const editable =
      (el.getAttribute("contenteditable") === "true" || el.getAttribute("role") === "textbox" ? el : null) ||
      card.querySelector<HTMLElement>('[contenteditable="true"], [role="textbox"]');
    if (editable) {
      editable.focus();
      editable.textContent = mapping.value;
      editable.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, composed: true, data: mapping.value }));
      editable.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      editable.blur();
      return Boolean((editable.textContent ?? "").trim());
    }
    return false;
  }

  function isControlFilled(fieldKey: string, el: HTMLElement): boolean {
    const card = findCard(fieldKey) || el;
    if (card.querySelector('[role="listbox"]') || el.getAttribute("role") === "listbox") {
      const listbox = (el.getAttribute("role") === "listbox" ? el : card.querySelector('[role="listbox"]')) as HTMLElement | null;
      const selected = listbox?.querySelector('[role="option"][aria-selected="true"]');
      const selectedText = (selected?.textContent ?? "").trim().toLowerCase();
      return Boolean(selectedText && selectedText !== "choose" && !selectedText.includes("choose"));
    }
    if (card.querySelector('[role="radio"]') || (el instanceof HTMLInputElement && el.type === "radio")) {
      if (Array.from(card.querySelectorAll('[role="radio"]')).some((node) => node.getAttribute("aria-checked") === "true")) {
        return true;
      }
      return Array.from(
        document.querySelectorAll<HTMLInputElement>(`input[type="radio"][${APPLY_FIELD_ATTR}="${cssEscape(fieldKey)}"]`),
      ).some((node) => node.checked);
    }
    if (card.querySelector('[role="checkbox"]') || (el instanceof HTMLInputElement && el.type === "checkbox")) {
      if (Array.from(card.querySelectorAll('[role="checkbox"]')).some((node) => node.getAttribute("aria-checked") === "true")) {
        return true;
      }
      return Array.from(
        document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][${APPLY_FIELD_ATTR}="${cssEscape(fieldKey)}"]`),
      ).some((node) => node.checked);
    }
    const file = card.querySelector<HTMLInputElement>('input[type="file"]');
    if (file) return (file.files?.length ?? 0) > 0 || fileAlreadyUploaded(card);
    if (el instanceof HTMLInputElement && el.type === "file") {
      return (el.files?.length ?? 0) > 0 || fileAlreadyUploaded(card) || fileAlreadyUploaded(el);
    }
    if (/add file|upload|resume|cv|attach/i.test(card.textContent ?? "") && fileAlreadyUploaded(card)) return true;
    if (/add file/i.test(card.textContent ?? "") && /uploaded|selected file|\.pdf/i.test(card.textContent ?? "")) return true;
    if (el instanceof HTMLSelectElement) return Boolean(el.value);
    if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
      return Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="${el.type}"][${APPLY_FIELD_ATTR}="${cssEscape(fieldKey)}"]`)).some(
        (node) => node.checked,
      );
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const value = (el.value ?? "").trim();
      return Boolean(value) && !/^(your answer|your response|type your answer)$/i.test(value);
    }
    const text = card.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      "input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox]), textarea",
    );
    if (text?.value?.trim() && !/^(your answer|your response|type your answer)$/i.test(text.value.trim())) return true;
    const editable =
      (el.getAttribute("contenteditable") === "true" || el.getAttribute("role") === "textbox" ? el : null) ||
      card.querySelector<HTMLElement>('[contenteditable="true"], [role="textbox"]');
    const editableText = (editable?.textContent ?? "").replace(/\s+/g, " ").trim();
    return Boolean(editableText) && !/^(your answer|your response|type your answer)$/i.test(editableText);
  }

  function ensureHighlightStyle() {
    if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = `
      [${APPLY_EMPTY_ATTR}="1"] {
        outline: 2px solid #c45c26 !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 0 4px rgba(196, 92, 38, 0.16) !important;
        border-radius: 8px;
      }
    `;
    document.documentElement.append(style);
  }

  function clearHighlights() {
    for (const node of Array.from(document.querySelectorAll(`[${APPLY_EMPTY_ATTR}]`))) {
      node.removeAttribute(APPLY_EMPTY_ATTR);
    }
  }

  function highlightEmpty(fieldKeys: string[]) {
    ensureHighlightStyle();
    clearHighlights();
    const keys = fieldKeys.length
      ? fieldKeys
      : Array.from(document.querySelectorAll(`[${APPLY_FIELD_ATTR}]`)).map((node) => node.getAttribute(APPLY_FIELD_ATTR) || "");
    const seen = new Set<string>();
    for (const key of keys) {
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const el = findControl(key);
      if (!el) continue;
      if (isControlFilled(key, el)) continue;
      const card = findCard(key) || el;
      card.setAttribute(APPLY_EMPTY_ATTR, "1");
    }
  }

  function clearChips() {
    for (const node of Array.from(document.querySelectorAll(`[${WIDGET_ATTR}]`))) node.remove();
  }

  let menuCloserBound = false;
  function ensureMenuCloser() {
    if (menuCloserBound) return;
    menuCloserBound = true;
    document.addEventListener(
      "click",
      (event) => {
        const path = typeof event.composedPath === "function" ? event.composedPath() : [];
        if (path.some((node) => node instanceof Element && node.hasAttribute(WIDGET_ATTR))) return;
        closeAllAssistants();
      },
      true,
    );
  }

  function uniqueOptions(options: FillOption[] | undefined, primary: string): FillOption[] {
    const list = options?.length ? options : primary ? [{ value: primary }] : [];
    const seen = new Set<string>();
    const out: FillOption[] = [];
    for (const option of list) {
      const value = option.value?.trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push({ ...option, value });
    }
    if (primary.trim() && !seen.has(primary.trim())) out.unshift({ value: primary.trim() });
    return out;
  }

  function closeAllAssistants(except?: HTMLElement) {
    for (const host of Array.from(document.querySelectorAll(`[${WIDGET_ATTR}]`))) {
      if (except && host === except) continue;
      host.shadowRoot?.querySelector(".panel")?.classList.remove("open");
      host.shadowRoot?.querySelector(".menu")?.classList.remove("open");
    }
  }

  function mountAiAssistant(
    anchor: HTMLElement,
    fieldKey: string,
    question: string,
    fieldType: string,
    applicationId: string,
    memoryOptions: FillOption[],
  ) {
    const card = findCard(fieldKey) || anchor;
    card.querySelector(`[${WIDGET_ATTR}]`)?.remove();
    if (getComputedStyle(card).position === "static") card.style.position = "relative";

    const host = document.createElement("div");
    host.setAttribute(WIDGET_ATTR, "ai");
    host.style.cssText =
      "position:absolute;top:8px;right:8px;z-index:2147483646;font:12px/1.4 'Segoe UI',system-ui,sans-serif;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        @keyframes pop { from { transform: translateY(4px) scale(.96); opacity: 0; } to { transform: none; opacity: 1; } }
        @keyframes pulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
        .fab {
          width: 34px; height: 34px; border-radius: 12px; border: 1px solid #0e0e0e;
          background: linear-gradient(145deg, #e8f6ef, #d8efe4); color: #0e0e0e;
          font: 700 11px/1 ui-monospace, monospace; letter-spacing: .04em;
          cursor: pointer; box-shadow: 0 8px 22px rgba(14,14,14,.16);
          animation: pop .28s ease-out;
        }
        .fab:hover { background: #0e0e0e; color: #fff; }
        .panel {
          display: none; position: absolute; top: 42px; right: 0; width: min(360px, 86vw);
          background: #fbfbf7; border: 1px solid #e4e4dc; border-radius: 16px;
          box-shadow: 0 18px 40px rgba(14,14,14,.18); overflow: hidden; animation: pop .22s ease-out;
        }
        .panel.open { display: grid; }
        .head {
          display: flex; align-items: start; justify-content: space-between; gap: 10px;
          padding: 12px 14px 8px; border-bottom: 1px solid #ecece4;
        }
        .eyebrow { margin: 0; font: 10px/1.2 ui-monospace, monospace; letter-spacing: .14em; text-transform: uppercase; color: #6b6b63; }
        .title { margin: 4px 0 0; font: 600 14px/1.3 Georgia, 'Times New Roman', serif; color: #0e0e0e; }
        .close { all: unset; cursor: pointer; color: #6b6b63; font-size: 18px; line-height: 1; padding: 2px 4px; }
        .body { padding: 12px 14px; display: grid; gap: 10px; }
        .hint { margin: 0; color: #6b6b63; font: 12px/1.45 system-ui, sans-serif; }
        .limit {
          margin: 0; display: none; padding: 6px 10px; border-radius: 999px; width: fit-content;
          background: #e8f6ef; color: #0e0e0e; font: 600 11px/1.3 ui-monospace, monospace;
        }
        .limit.show { display: inline-block; }
        .guidance-label { margin: 0; color: #6b6b63; font: 11px/1.3 system-ui, sans-serif; }
        .guidance {
          width: 100%; min-height: 56px; max-height: 100px; resize: vertical; box-sizing: border-box;
          padding: 8px 10px; border-radius: 10px; border: 1px solid #e7e7e0; background: #fff;
          color: #0e0e0e; font: 12px/1.45 system-ui, sans-serif;
        }
        .guidance:focus { outline: 2px solid #0e0e0e; outline-offset: 1px; }
        .draft {
          display: none; max-height: 220px; overflow: auto; padding: 12px;
          border-radius: 12px; background: #fff; border: 1px solid #e7e7e0;
          white-space: pre-wrap; color: #0e0e0e; font: 13px/1.55 Georgia, 'Times New Roman', serif;
        }
        .draft.show { display: block; }
        .status { min-height: 1.2em; margin: 0; color: #6b6b63; font: 11px/1.4 ui-monospace, monospace; }
        .status.busy { animation: pulse 1.1s ease-in-out infinite; }
        .status.err { color: #7a2e24; }
        .actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .btn {
          border: 1px solid #0e0e0e; border-radius: 999px; padding: 8px 14px;
          font: 600 12px/1 system-ui, sans-serif; cursor: pointer; background: #0e0e0e; color: #fff;
        }
        .btn.secondary { background: transparent; color: #0e0e0e; }
        .btn:disabled { opacity: .45; cursor: default; }
        .mem { display: none; gap: 4px; }
        .mem.show { display: grid; }
        .mem button {
          all: unset; cursor: pointer; padding: 8px 10px; border-radius: 10px; background: #fff;
          border: 1px solid #ecece4; font: 12px/1.4 system-ui, sans-serif; color: #0e0e0e;
        }
        .mem button:hover { background: #f3f4ef; }
        .mem .meta { display: block; margin-top: 2px; font: 10px/1.3 ui-monospace, monospace; color: #6b6b63; }
      </style>
      <button class="fab" type="button" title="1-Apply AI assistant" aria-label="Open 1-Apply AI assistant">1A</button>
      <div class="panel" role="dialog" aria-label="1-Apply AI draft">
        <div class="head">
          <div>
            <p class="eyebrow">1-Apply</p>
            <p class="title">Draft from memory</p>
          </div>
          <button class="close" type="button" aria-label="Close">×</button>
        </div>
        <div class="body">
          <p class="hint">Generate from Application Memory. Optional notes below are included in the draft.</p>
          <p class="limit"></p>
          <label class="guidance-label">Add to this draft (optional)</label>
          <textarea class="guidance" placeholder="e.g. also mention my 3 years of freelancing" aria-label="Add guidance for this draft"></textarea>
          <div class="draft" aria-live="polite"></div>
          <p class="status"></p>
          <div class="actions">
            <button class="btn generate" type="button">Generate</button>
            <button class="btn secondary confirm" type="button" disabled>Confirm</button>
            <button class="btn secondary regenerate" type="button" disabled>Regenerate</button>
          </div>
          <div class="mem"></div>
        </div>
      </div>
    `;

    const fab = shadow.querySelector(".fab") as HTMLButtonElement;
    const panel = shadow.querySelector(".panel") as HTMLDivElement;
    const draftEl = shadow.querySelector(".draft") as HTMLDivElement;
    const statusEl = shadow.querySelector(".status") as HTMLParagraphElement;
    const limitEl = shadow.querySelector(".limit") as HTMLParagraphElement;
    const guidanceEl = shadow.querySelector(".guidance") as HTMLTextAreaElement;
    const generateBtn = shadow.querySelector(".generate") as HTMLButtonElement;
    const confirmBtn = shadow.querySelector(".confirm") as HTMLButtonElement;
    const regenerateBtn = shadow.querySelector(".regenerate") as HTMLButtonElement;
    const closeBtn = shadow.querySelector(".close") as HTMLButtonElement;
    const memEl = shadow.querySelector(".mem") as HTMLDivElement;
    let draftText = "";

    const lengthLimit: FieldLengthLimit | null = detectFieldLengthLimit(
      anchor,
      question,
      `${card.textContent ?? ""}`.slice(0, 600),
    );
    if (lengthLimit) {
      limitEl.textContent = describeFieldLengthLimit(lengthLimit);
      limitEl.classList.add("show");
    }

    guidanceEl.addEventListener("click", (event) => event.stopPropagation());
    guidanceEl.addEventListener("keydown", (event) => event.stopPropagation());

    if (memoryOptions.length) {
      memEl.classList.add("show");
      const label = document.createElement("p");
      label.className = "hint";
      label.textContent = "Or insert a saved memory answer:";
      memEl.append(label);
      for (const option of memoryOptions.slice(0, 4)) {
        const button = document.createElement("button");
        button.type = "button";
        button.innerHTML = `<span></span><span class="meta"></span>`;
        (button.querySelector("span") as HTMLElement).textContent =
          option.value.length > 180 ? `${option.value.slice(0, 180)}…` : option.value;
        (button.querySelector(".meta") as HTMLElement).textContent = option.source || option.label || "Application Memory";
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          draftText = option.value;
          draftEl.textContent = draftText;
          draftEl.classList.add("show");
          confirmBtn.disabled = false;
          regenerateBtn.disabled = false;
          statusEl.textContent = "Loaded from Application Memory — Confirm to fill the form.";
          statusEl.className = "status";
        });
        memEl.append(button);
      }
    }

    async function runGenerate() {
      if (!applicationId) {
        statusEl.textContent = "No application selected. Save this page in 1-Apply first.";
        statusEl.className = "status err";
        return;
      }
      generateBtn.disabled = true;
      regenerateBtn.disabled = true;
      confirmBtn.disabled = true;
      const guidance = guidanceEl.value.trim();
      statusEl.textContent = lengthLimit
        ? `Reading Application Memory… targeting ${describeFieldLengthLimit(lengthLimit).toLowerCase()}.`
        : "Reading Application Memory…";
      statusEl.className = "status busy";
      try {
        const result = await new Promise<{ draft: string; grounded: boolean; limitApplied?: boolean }>((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              type: "GENERATE_AI_DRAFT",
              applicationId,
              question,
              fieldKey,
              guidance: guidance || undefined,
              limitValue: lengthLimit?.value ?? null,
              limitUnit: lengthLimit?.unit ?? null,
            },
            (response) => {
              const err = chrome.runtime.lastError;
              if (err) reject(new Error(err.message));
              else if (response && typeof response === "object" && "error" in response && (response as { error?: string }).error)
                reject(new Error((response as { error: string }).error));
              else resolve(response as { draft: string; grounded: boolean; limitApplied?: boolean });
            },
          );
        });
        draftText = result.draft;
        draftEl.textContent = draftText;
        draftEl.classList.add("show");
        confirmBtn.disabled = !draftText;
        regenerateBtn.disabled = false;
        const bits = [
          result.grounded ? "Draft ready" : "Draft ready (memory looked thin — review carefully)",
          lengthLimit ? describeFieldLengthLimit(lengthLimit) : null,
          result.limitApplied ? "trimmed to fit" : null,
          "Confirm to fill",
        ].filter(Boolean);
        statusEl.textContent = `${bits.join(" · ")}.`;
        statusEl.className = "status";
      } catch (error) {
        statusEl.textContent = error instanceof Error ? error.message : "Could not generate draft.";
        statusEl.className = "status err";
        regenerateBtn.disabled = false;
      } finally {
        generateBtn.disabled = false;
      }
    }

    fab.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = !panel.classList.contains("open");
      closeAllAssistants(host);
      panel.classList.toggle("open", open);
    });
    closeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      panel.classList.remove("open");
    });
    generateBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void runGenerate();
    });
    regenerateBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void runGenerate();
    });
    confirmBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!draftText.trim()) return;
      void (async () => {
        const ok = await applyValue(anchor, { fieldKey, value: draftText, type: fieldType });
        if (ok) {
          card.removeAttribute(APPLY_EMPTY_ATTR);
          statusEl.textContent = "Filled into the form.";
          statusEl.className = "status";
          panel.classList.remove("open");
        } else {
          statusEl.textContent = "Could not fill this field — try clicking the input first.";
          statusEl.className = "status err";
        }
      })();
    });

    panel.addEventListener("click", (event) => event.stopPropagation());
    ensureMenuCloser();
    card.append(host);
  }

  function mountChip(anchor: HTMLElement, fieldKey: string, options: FillOption[], fieldType: string) {
    if (!options.length) return;
    const card = findCard(fieldKey) || anchor;
    card.querySelector(`[${WIDGET_ATTR}]`)?.remove();
    if (getComputedStyle(card).position === "static") card.style.position = "relative";

    const host = document.createElement("div");
    host.setAttribute(WIDGET_ATTR, "1");
    host.style.cssText =
      "position:absolute;top:10px;right:10px;z-index:2147483646;font:12px/1 system-ui,sans-serif;animation:oneapply-pop .28s ease-out;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        @keyframes pop { from { transform: scale(.7); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .chip {
          min-width: 26px; height: 26px; padding: 0 8px; border-radius: 999px;
          border: 1px solid #0e0e0e; background: #d8efe4; color: #0e0e0e;
          display: inline-grid; place-items: center; cursor: pointer; gap: 4px;
          box-shadow: 0 4px 14px rgba(0,0,0,.14);
          font: 700 11px/1 system-ui, sans-serif;
          animation: pop .28s ease-out;
        }
        .chip:hover { background: #0e0e0e; color: #fff; }
        .menu {
          display: none; position: absolute; top: 32px; right: 0;
          min-width: 260px; max-width: 380px; max-height: 300px; overflow: auto;
          background: #fff; border: 1px solid #e7e7e0; border-radius: 14px;
          box-shadow: 0 12px 30px rgba(0,0,0,.16); padding: 6px;
        }
        .menu.open { display: grid; gap: 4px; }
        button.opt {
          all: unset; cursor: pointer; display: grid; gap: 2px;
          padding: 10px 12px; border-radius: 10px; color: #0e0e0e;
        }
        button.opt:hover { background: #f3f4ef; }
        .val { font: 12px/1.4 system-ui, sans-serif; white-space: pre-wrap; }
        .meta { font: 10px/1.3 ui-monospace, monospace; color: #6b6b63; }
      </style>
      <button class="chip" type="button" title="1-Apply suggestions" aria-label="Show 1-Apply suggestions">1A · ${options.length}</button>
      <div class="menu" role="listbox"></div>
    `;

    const chip = shadow.querySelector(".chip") as HTMLButtonElement;
    const menu = shadow.querySelector(".menu") as HTMLDivElement;
    for (const option of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "opt";
      button.innerHTML = `<span class="val"></span><span class="meta"></span>`;
      (button.querySelector(".val") as HTMLElement).textContent = option.label && fieldType === "file" ? option.label : option.value;
      (button.querySelector(".meta") as HTMLElement).textContent =
        [option.label && fieldType !== "file" ? option.label : "", option.source].filter(Boolean).join(" · ") || "Application Memory";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void (async () => {
          await applyValue(anchor, {
            fieldKey,
            value: option.value,
            type: fieldType,
            file: fieldType === "file" ? { versionId: option.value, filename: option.label || "document.pdf", mimeType: "application/pdf", base64: "" } : null,
          });
          card.removeAttribute(APPLY_EMPTY_ATTR);
          menu.classList.remove("open");
        })();
      });
      menu.append(button);
    }

    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = menu.classList.toggle("open");
      if (open) closeAllAssistants(host);
    });

    ensureMenuCloser();
    card.append(host);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SET_AUTO_SUBMIT_HOST") {
      root.__1APPLY_AUTO_SUBMIT_HOST = Boolean(message.enabled);
      if (message.enabled) {
        root.__1APPLY_STOPPED = false;
        enableAutoContinueWatch();
      }
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "TRY_AUTO_ADVANCE") {
      void tryAutoAdvance().then(sendResponse);
      return true;
    }

    if (message?.type === "TRY_AUTO_SUBMIT") {
      void tryAutoSubmit().then(sendResponse);
      return true;
    }

    if (message?.type === "STOP_AUTO_CONTINUE") {
      disableAutoContinueWatch();
      showToast("1-Apply stopped filling this page.");
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "GET_PAGE_META") {
      const pageText = document.body?.innerText?.slice(0, 20_000) ?? "";
      sendResponse({
        type: "PAGE_META_RESULT",
        url: location.href,
        title: document.title,
        excerpt: pageText.slice(0, 4000),
        pageText,
      });
      return false;
    }

    if (message?.type === "INVENTORY") {
      const fields = inventoryFromDocument(document);
      const hazards = inspectPage(document, document.body?.innerText ?? "", fields);
      sendResponse({
        type: "INVENTORY_RESULT",
        fields,
        hazards,
        html: document.documentElement.outerHTML.slice(0, 20_000),
        url: location.href,
        title: document.title,
      });
      return false;
    }

    if (message?.type === "INVENTORY_BATCH") {
      const fields = inventoryFromDocument(document);
      const eligible = fieldsEligibleForBatch(fields);
      stampBatchFieldIds(document, eligible);
      const extras: Record<string, { currentValue?: string; maxLength?: number }> = {};
      for (const field of eligible) {
        const el = findControl(field.key);
        const limit = el ? detectFieldLengthLimit(el, field.label, field.nearbyText) : null;
        extras[field.key] = {
          currentValue: readControlValue(field.key, field.type) || undefined,
          maxLength: limit?.unit === "characters" ? limit.value : undefined,
        };
      }
      sendResponse({
        type: "INVENTORY_BATCH_RESULT",
        fields: toBatchFieldInputs(eligible, extras),
        hazards: inspectPage(document, document.body?.innerText ?? "", fields),
        url: location.href,
        title: document.title,
      });
      return false;
    }

    if (message?.type === "CAPTURE_FILLED_STATE") {
      const fields = inventoryFromDocument(document);
      const eligible = fieldsEligibleForBatch(fields);
      stampBatchFieldIds(document, eligible);
      const extras: Record<string, { currentValue?: string; maxLength?: number }> = {};
      for (const field of eligible) {
        const el = findControl(field.key);
        const limit = el ? detectFieldLengthLimit(el, field.label, field.nearbyText) : null;
        extras[field.key] = {
          currentValue: readControlValue(field.key, field.type) || undefined,
          maxLength: limit?.unit === "characters" ? limit.value : undefined,
        };
      }
      const batchFields = toBatchFieldInputs(eligible, extras);
      const keyByFieldId = new Map(batchFields.map((field, index) => [field.fieldId, eligible[index]?.key ?? field.fieldId]));
      const captured = batchFields.map((field) => ({
        fieldKey: keyByFieldId.get(field.fieldId) ?? field.fieldId,
        fieldId: field.fieldId,
        label: field.label,
        value: field.currentValue ?? "",
        required: Boolean(field.required),
        fieldType: field.type,
        options: field.options,
        maxLength: field.maxLength,
        nearbyText: field.nearbyText,
        placeholder: field.placeholder,
      }));
      const pageText = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 20_000);
      sendResponse({
        type: "CAPTURE_FILLED_STATE_RESULT",
        origin: location.origin,
        pageUrl: location.href,
        pageText,
        fields: captured,
        formPage: {
          pageIndex: 0,
          pageUrl: location.href,
          pageTitle: document.title,
          origin: location.origin,
          hazards: inspectPage(document, document.body?.innerText ?? "", fields),
          fields: batchFields.map((field) => ({
            ...field,
            fieldKey: keyByFieldId.get(field.fieldId),
          })),
        },
      });
      return false;
    }

    if (message?.type === "ATTACH_FILE_IN_FRAME") {
      const file = message.file as AttachedFile;
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
      let ok = false;
      for (const input of inputs) {
        if (applyFile(input, file)) ok = true;
      }
      sendResponse({ ok });
      return false;
    }

    if (message?.type === "APPLY_BATCH_RESULTS") {
      assertFillActionAllowed("setValue");
      const expectedOrigin = String(message.origin ?? "");
      if (expectedOrigin && location.origin !== expectedOrigin) {
        sendResponse({ type: "FILL_RESULT", filled: [], error: "Origin mismatch" });
        return false;
      }

      void (async () => {
        root.__1APPLY_FILLING = true;
        try {
          const scanned = inventoryFromDocument(document);
          stampBatchFieldIds(document, fieldsEligibleForBatch(scanned));
          const applicationId = String(message.applicationId ?? "");
          const files = new Map<string, AttachedFile>();
          for (const file of (message.files ?? []) as AttachedFile[]) {
            if (file?.versionId) files.set(file.versionId, file);
          }

          const results: Array<{ fieldId: string; filled: boolean; skippedReason?: string }> = [];
          const highlightKeys: string[] = [];

          for (const result of (message.results ?? []) as Array<{
            fieldId: string;
            status: "filled" | "need_you";
            value?: string;
            documentVersionId?: string;
            type?: string;
          }>) {
            const el = findControlByBatchId(result.fieldId);
            const fieldKey = el?.getAttribute(APPLY_FIELD_ATTR) || result.fieldId;
            if (!el) {
              results.push({ fieldId: result.fieldId, filled: false, skippedReason: "Control not found" });
              highlightKeys.push(fieldKey);
              continue;
            }
            const card = findCard(fieldKey) || el;
            const resultType = String(result.type ?? "");
            const inferredType =
              resultType === "radio" ||
              resultType === "checkbox" ||
              resultType === "select" ||
              resultType === "file" ||
              resultType === "textarea"
                ? resultType
                : el instanceof HTMLSelectElement || card.querySelector('[role="listbox"]')
                  ? "select"
                  : el instanceof HTMLInputElement && el.type === "radio" || card.querySelector('[role="radio"]')
                    ? "radio"
                    : el instanceof HTMLInputElement && el.type === "checkbox" || card.querySelector('[role="checkbox"]')
                      ? "checkbox"
                      : el instanceof HTMLTextAreaElement
                        ? "textarea"
                        : el instanceof HTMLInputElement
                          ? el.type === "file"
                            ? "file"
                            : "text"
                          : el.getAttribute("contenteditable") === "true" || el.getAttribute("role") === "textbox"
                            ? "textarea"
                            : resultType || "text";
            const isChoice =
              inferredType === "radio" || inferredType === "checkbox" || inferredType === "select" || inferredType === "file";

            if (!isChoice && isControlFilled(fieldKey, el)) {
              card.removeAttribute(APPLY_EMPTY_ATTR);
              results.push({ fieldId: result.fieldId, filled: true, skippedReason: "already filled" });
              continue;
            }

            if (result.status !== "filled") {
              highlightKeys.push(fieldKey);
              if (inferredType === "text" || inferredType === "textarea") {
                const question =
                  findCard(fieldKey)?.querySelector('[role="heading"]')?.textContent?.trim() ||
                  (el.getAttribute("aria-label") ?? "") ||
                  fieldKey;
                mountAiAssistant(el, fieldKey, question, inferredType, applicationId, []);
              }
              results.push({ fieldId: result.fieldId, filled: false, skippedReason: "need_you" });
              continue;
            }

            if (!fillTargetAllowed(fieldKey, inferredType)) {
              results.push({ fieldId: result.fieldId, filled: false, skippedReason: "Protected control" });
              continue;
            }

            const versionId = result.documentVersionId;
            const file = versionId ? files.get(versionId) : undefined;
            const filled = await applyValue(el, {
              fieldKey,
              value: versionId || result.value || "",
              type: versionId ? "file" : inferredType,
              file: file
                ? file
                : versionId
                  ? {
                      versionId,
                      filename: "document.pdf",
                      mimeType: "application/pdf",
                      base64: "",
                    }
                  : null,
            });
            if (filled) {
              card.removeAttribute(APPLY_EMPTY_ATTR);
              results.push({ fieldId: result.fieldId, filled: true });
            } else {
              highlightKeys.push(fieldKey);
              results.push({
                fieldId: result.fieldId,
                filled: false,
                skippedReason: file ? "Could not attach file" : "Could not apply value",
              });
            }
          }

          highlightEmpty(highlightKeys);

          if (message.resumeFill) {
            root.__1APPLY_STOPPED = false;
          }

          if (message.autoContinue) {
            if (root.__1APPLY_STOPPED) {
              sendResponse({
                type: "FILL_RESULT",
                filled: results,
                highlighted: document.querySelectorAll(`[${APPLY_EMPTY_ATTR}]`).length,
                stopped: true,
              });
              return;
            }
            enableAutoContinueWatch();
            root.__1APPLY_LAST_PAGE_FP = pageFingerprint();
            root.__1APPLY_CONTINUE_TRIES = 0;
            const filledCount = results.filter((item) => item.filled).length;
            const stillEmpty = document.querySelectorAll(`[${APPLY_EMPTY_ATTR}]`).length;
            showToast(
              stillEmpty
                ? `1-Apply filled ${filledCount}. ${stillEmpty} question(s) still empty — tap 1A or complete them before Next.`
                : filledCount
                  ? `1-Apply filled ${filledCount} field(s).`
                  : "1-Apply ready — tap 1A for AI questions.",
            );
          }

          sendResponse({
            type: "FILL_RESULT",
            filled: results,
            highlighted: document.querySelectorAll(`[${APPLY_EMPTY_ATTR}]`).length,
          });
        } finally {
          root.__1APPLY_FILLING = false;
        }

        const stillEmpty = document.querySelectorAll(`[${APPLY_EMPTY_ATTR}]`).length;
        if (message.autoContinue && isFillActive() && stillEmpty === 0) {
          await sleep(450);
          if (isFillActive()) await tryAutoAdvance();
        }
      })();

      return true;
    }

    if (message?.type === "FILL" || message?.type === "APPLY_SUGGESTIONS" || message?.type === "APPLY_SUGGESTIONS") {
      assertFillActionAllowed("setValue");
      const expectedOrigin = String(message.origin ?? "");
      if (expectedOrigin && location.origin !== expectedOrigin) {
        sendResponse({ type: "FILL_RESULT", filled: [], error: "Origin mismatch" });
        return false;
      }

      void (async () => {
        root.__1APPLY_FILLING = true;
        try {
          inventoryFromDocument(document);
          clearChips();
          clearHighlights();
          const applicationId = String(message.applicationId ?? "");

          const results: Array<{ fieldKey: string; filled: boolean; skippedReason?: string; hasAlternates?: boolean }> = [];
          const assisted = new Set<string>();

      for (const mapping of (message.mappings ?? []) as FillPayload[]) {
            const options = uniqueOptions(mapping.options, mapping.aiAnswerable ? "" : mapping.value);
        const el = findControl(mapping.fieldKey);
        if (!el) {
          results.push({ fieldKey: mapping.fieldKey, filled: false, skippedReason: "Control not found" });
          continue;
        }
            if (!fillTargetAllowed(mapping.fieldKey, mapping.type)) {
              results.push({ fieldKey: mapping.fieldKey, filled: false, skippedReason: "Protected control" });
              continue;
            }

            let filled = false;
            if (!mapping.aiAnswerable && (mapping.value || mapping.file?.base64)) {
              filled = await applyValue(el, mapping);
              if (!filled) {
                results.push({
                  fieldKey: mapping.fieldKey,
                  filled: false,
                  skippedReason: mapping.type === "file" ? "Could not attach file" : "Could not apply value",
                });
              }
            }

            const wantsAi =
              Boolean(mapping.aiAnswerable) ||
              ((mapping.type === "text" || mapping.type === "textarea" || mapping.type === "url" || mapping.type === "number" || mapping.type === "date") &&
                !mapping.value &&
                !mapping.file?.base64);

            if (wantsAi) {
              const question =
                mapping.label?.trim() ||
                findCard(mapping.fieldKey)?.querySelector('[role="heading"]')?.textContent?.trim() ||
                mapping.fieldKey;
              mountAiAssistant(el, mapping.fieldKey, question, mapping.type, applicationId, options);
              assisted.add(mapping.fieldKey);
              results.push({ fieldKey: mapping.fieldKey, filled: false, hasAlternates: true, skippedReason: "Awaiting AI Confirm" });
              continue;
            }

            if (options.length > 0 || mapping.showChip) {
              const chipOptions =
                options.length > 0
                  ? options
                  : mapping.value
                    ? [{ value: mapping.value, label: mapping.label || "Suggestion", source: "Application Memory" }]
                    : [];
              if (chipOptions.length > 0) {
                mountChip(el, mapping.fieldKey, chipOptions, mapping.type);
                assisted.add(mapping.fieldKey);
              }
            }

            if (filled) {
              results.push({ fieldKey: mapping.fieldKey, filled: true, hasAlternates: options.length > 1 });
            } else if (options.length > 0 && !(mapping.value || mapping.file?.base64)) {
              results.push({ fieldKey: mapping.fieldKey, filled: false, hasAlternates: true, skippedReason: "Awaiting chip selection" });
            } else if (!(mapping.value || mapping.file?.base64)) {
              results.push({ fieldKey: mapping.fieldKey, filled: false, skippedReason: "Empty value" });
            }
          }

          // Safety net: every detected input field gets a popup/chip if still missing one.
          const liveFields = inventoryFromDocument(document);
          for (const field of liveFields) {
            if (assisted.has(field.key)) continue;
            if (isProtectedControl(field) || isSensitiveField(field)) continue;
            const el = findControl(field.key);
            if (!el) continue;
            const card = findCard(field.key) || el;
            if (card.querySelector(`[${WIDGET_ATTR}]`)) continue;

            const choiceType =
              field.type === "radio" || field.type === "checkbox" || field.type === "select" || field.type === "multi-select";
            if (choiceType && field.options.length) {
              mountChip(
                el,
                field.key,
                field.options.map((value) => ({ value, label: field.label || "Form option", source: "Form choice" })),
                field.type,
              );
              assisted.add(field.key);
              continue;
            }

            if (field.type === "text" || field.type === "textarea" || field.type === "url" || field.type === "number" || field.type === "date") {
              if (isControlFilled(field.key, el)) continue;
              mountAiAssistant(el, field.key, field.label || field.key, field.type, applicationId, []);
              assisted.add(field.key);
            }
          }

          // Safety net: verified Google Forms email collection is always a sole required checkbox.
          const emailConsent = Array.from(document.querySelectorAll<HTMLElement>('[role="checkbox"]')).filter((node) =>
            /record\s+.+\s+as the email to be included with my response/i.test(
              `${node.getAttribute("aria-label") ?? ""} ${node.textContent ?? ""}`,
            ),
          );
          for (const box of emailConsent) {
            if (box.getAttribute("aria-checked") === "true") continue;
            activateToggle(box);
            await sleep(50);
            if (box.getAttribute("aria-checked") !== "true") activateToggle(box.parentElement as HTMLElement);
            results.push({ fieldKey: "google-email-consent", filled: box.getAttribute("aria-checked") === "true" });
          }

          const highlightKeys = Array.isArray(message.highlightKeys)
            ? (message.highlightKeys as string[])
            : ((message.mappings ?? []) as FillPayload[]).map((item) => item.fieldKey);
          highlightEmpty(highlightKeys);

          // Explicit Fill from the popup clears Stop; auto-continue mid-flight does not.
          if (message.resumeFill) {
            root.__1APPLY_STOPPED = false;
          }

          if (message.autoContinue) {
            if (root.__1APPLY_STOPPED) {
              sendResponse({
                type: "FILL_RESULT",
                filled: results,
                highlighted: document.querySelectorAll(`[${APPLY_EMPTY_ATTR}]`).length,
                stopped: true,
              });
              return;
            }
            enableAutoContinueWatch();
            root.__1APPLY_LAST_PAGE_FP = pageFingerprint();
            root.__1APPLY_CONTINUE_TRIES = 0;
            const filledCount = results.filter((item) => item.filled).length;
            showToast(filledCount ? `1-Apply filled ${filledCount} field(s).` : "1-Apply ready — tap 1A for AI questions.");
          }

          sendResponse({
            type: "FILL_RESULT",
            filled: results,
            highlighted: document.querySelectorAll(`[${APPLY_EMPTY_ATTR}]`).length,
          });
        } finally {
          root.__1APPLY_FILLING = false;
        }

        // Multi-page: click Next/Continue (never Submit), then continueFill → Need You pipeline.
        if (message.autoContinue && isFillActive()) {
          await sleep(450);
          if (isFillActive()) await tryAutoAdvance();
        }
      })();

      return true;
    }

    return false;
  });
}
