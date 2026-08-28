/**
 * Classify and find multi-step form advance controls (Next / Continue).
 * Never treat final Submit / Pay as step advance.
 */

export type ActionControlKind = "next" | "submit" | "other";

const CONTROL_SELECTOR =
  'button, a[href], [role="button"], input[type="button"], input[type="submit"], [data-action], [data-testid], [data-qa]';

/** Final-submit language — must not be auto-clicked. */
const FINAL_SUBMIT_RE =
  /\b(submit application|submit form|submit your application|place order|pay now|finalize|confirm payment|complete application|send application|finish application|apply now)\b/i;

/** Step-advance language (Next and common aliases). */
const STEP_ADVANCE_RE =
  /\b(next|continue|proceed|weiter|siguiente|suivant|avanti|próximo|proximo|siguiente paso|save\s*(&|and)?\s*continue|save\s*(&|and)?\s*next|continue\s*to|go\s*to\s*(the\s*)?(next\s*)?(step|page)|step\s*\d+|page\s*\d+|review(\s+application)?)\b/i;

const STEP_ADVANCE_ATTR_RE =
  /\b(btn[-_]?next|step[-_]?next|wizard[-_]?next|continue[-_]?btn|next[-_]?step|nextButton|continueButton)\b/i;

export function controlSignalText(el: Element): string {
  const control = el as HTMLElement;
  return [
    control.textContent ?? "",
    control.getAttribute("aria-label") ?? "",
    control.getAttribute("title") ?? "",
    control.getAttribute("value") ?? "",
    control.getAttribute("name") ?? "",
    control.getAttribute("data-action") ?? "",
    control.getAttribute("data-testid") ?? "",
    control.getAttribute("data-qa") ?? "",
    control.id ?? "",
    typeof control.className === "string" ? control.className : "",
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyActionControl(el: Element): ActionControlKind {
  const text = controlSignalText(el);
  if (!text) return "other";

  const hasAdvance = STEP_ADVANCE_RE.test(text) || STEP_ADVANCE_ATTR_RE.test(text);
  const hasFinal = FINAL_SUBMIT_RE.test(text);

  // Explicit final submit without Next/Continue → submit.
  if (hasFinal && !hasAdvance) return "submit";
  // "Submit & continue" style still advances.
  if (hasAdvance) return "next";

  // Bare type=submit with no next language is usually final on single-page forms.
  const tag = el.tagName?.toLowerCase?.() ?? "";
  const typeAttr = (
    typeof (el as Element).getAttribute === "function"
      ? (el as Element).getAttribute("type")
      : null
  ) || ("type" in el ? String((el as { type?: string }).type ?? "") : "");
  if ((tag === "button" || tag === "input") && typeAttr.toLowerCase() === "submit" && !hasAdvance) {
    // Google Forms "Submit" on last page — treat as submit.
    if (/\bsubmit\b/i.test(text)) return "submit";
  }

  return "other";
}

function isVisibleEnabled(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.getAttribute("aria-disabled") === "true") return false;
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return true;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") {
    return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  return true;
}

/** All visible Next/Continue-like controls in the document (or subtree). */
export function findStepAdvanceControls(root: ParentNode): HTMLElement[] {
  const nodes = Array.from(root.querySelectorAll(CONTROL_SELECTOR)) as HTMLElement[];
  const seen = new Set<HTMLElement>();
  const out: HTMLElement[] = [];

  for (const node of nodes) {
    const control = (node.closest(CONTROL_SELECTOR) as HTMLElement | null) ?? node;
    if (seen.has(control)) continue;
    seen.add(control);
    if (classifyActionControl(control) !== "next") continue;
    if (!isVisibleEnabled(control)) continue;
    out.push(control);
  }

  // Prefer controls lower on the page (primary wizard CTA).
  out.sort((a, b) => {
    if (typeof a.getBoundingClientRect !== "function") return 0;
    return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
  });
  return out;
}

/** Best single Next/Continue target, or null if none (last page / no wizard). */
export function findPrimaryStepAdvance(root: ParentNode): HTMLElement | null {
  const controls = findStepAdvanceControls(root);
  if (!controls.length) return null;

  // Prefer exact "Next" / "Continue" over weaker "Review".
  const preferred = controls.find((el) =>
    /\b(next|continue|save\s*(&|and)?\s*continue)\b/i.test(controlSignalText(el)),
  );
  return preferred ?? controls[controls.length - 1] ?? null;
}

export function isStepAdvanceControl(el: Element | null): boolean {
  if (!el) return false;
  const control = el.closest(CONTROL_SELECTOR) as HTMLElement | null;
  if (!control) return false;
  return classifyActionControl(control) === "next";
}
