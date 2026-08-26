import type { DetectedField } from "./types";

/** Tokens that are DOM ids/names, not human questions. */
export function isMachineFieldToken(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (!text) return true;
  if (text.length >= 20 && /^[a-f0-9_-]+$/i.test(text)) return true;
  if (/^[0-9a-f]{8,}$/i.test(text)) return true;
  if (/^(entry\.\d+|wf-\d+|form_field_|field_|input_|ctl\d+)/i.test(text)) return true;
  if (/^(csrf|xsrf|authenticity|recaptcha|g-recaptcha|utm_|tracking|session)/i.test(text)) return true;
  // Bare technical slugs with no spaces and no natural language.
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+){0,4}$/i.test(text) && !/[? ]/.test(text) && text.length <= 40) {
    // Allow common human-ish slugs only when they include readable words AND we have no better label.
    // Still treated as weak/machine for title purposes unless humanized.
    return !/\b(name|email|phone|city|country|resume|linkedin|github|portfolio|address|birth|university|school|degree)\b/i.test(
      text.replace(/[-_]/g, " "),
    );
  }
  return false;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Turn `share_link` / `fullName` into a short readable title when nothing else exists. */
export function humanizeFieldToken(value: string): string {
  const cleaned = value
    .replace(/^(entry\.\d+|listitem:|labelledby:|aria:|radio:|pos:)/i, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return value;
  return cleaned.replace(/\b\w/g, (ch) => ch.toUpperCase()).slice(0, 120);
}

/**
 * Best human-facing question text for a detected field.
 * Prefer visible question copy; never surface raw Mongo/hex ids to users.
 */
export function humanQuestionLabel(
  field: Pick<DetectedField, "label" | "nearbyText" | "ariaLabel" | "placeholder" | "name" | "id" | "key">,
): string {
  const candidates = [field.label, field.nearbyText, field.ariaLabel, field.placeholder]
    .map((item) => collapseWhitespace(item ?? ""))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (!isMachineFieldToken(candidate) && candidate.length >= 2) {
      return candidate.slice(0, 200);
    }
  }

  // Weak fallbacks: humanize name/key only when they look like readable slugs.
  for (const raw of [field.name, field.key, field.id]) {
    const token = collapseWhitespace(raw ?? "");
    if (!token || isMachineFieldToken(token)) continue;
    return humanizeFieldToken(token);
  }

  for (const raw of [field.name, field.key]) {
    const token = collapseWhitespace(raw ?? "");
    if (!token) continue;
    if (/^[a-f0-9]{16,}$/i.test(token)) continue;
    return humanizeFieldToken(token);
  }

  return "Form question";
}

/** Fields that are plumbing, not applicant questions — skip in Need You / fill assist. */
export function isNoiseFormField(
  field: Pick<DetectedField, "label" | "nearbyText" | "ariaLabel" | "placeholder" | "name" | "id" | "key" | "type" | "inputType">,
): boolean {
  const blob = [field.name, field.id, field.key, field.label, field.ariaLabel].join(" ").toLowerCase();
  if (field.inputType === "hidden") return true;
  if (/csrf|xsrf|authenticity_token|recaptcha|honeypot|botcheck|utm_|tracking[_-]?id|session[_-]?id/i.test(blob)) {
    return true;
  }
  // Share-link widgets with no human question text.
  if (/share[-_]?link|copy[-_]?link|invite[-_]?token/i.test(blob)) {
    const question = humanQuestionLabel(field);
    if (question === "Form question" || isMachineFieldToken(question) || /^share\s*link$/i.test(question)) {
      return true;
    }
  }
  // Pure machine id with no readable question context.
  const question = humanQuestionLabel(field);
  if (question === "Form question" && isMachineFieldToken(field.key) && isMachineFieldToken(field.name || field.id)) {
    return true;
  }
  return false;
}
