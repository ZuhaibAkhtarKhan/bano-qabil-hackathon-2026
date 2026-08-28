import type { DetectedField } from "./types";

/** Tokens that are DOM ids/names, not human questions. */
export function isMachineFieldToken(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (!text) return true;
  if (text.length >= 20 && /^[a-f0-9_-]+$/i.test(text)) return true;
  if (/^[0-9a-f]{8,}$/i.test(text)) return true;
  if (/^(entry\.\d+|wf-\d+|form_field_|field_|input_|ctl\d+)/i.test(text)) return true;
  if (/^(csrf|xsrf|authenticity|recaptcha|g-recaptcha|utm_|tracking|session)/i.test(text)) return true;
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+){0,4}$/i.test(text) && !/[? ]/.test(text) && text.length <= 40) {
    return !/\b(name|email|phone|city|country|resume|linkedin|github|portfolio|address|birth|university|school|degree)\b/i.test(
      text.replace(/[-_]/g, " "),
    );
  }
  return false;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Multilingual “required / mandatory” chrome scraped from ATS/job boards
 * (e.g. Swedish ***Obligatoriskt***) — not part of the applicant question.
 * Requiredness is tracked separately via DetectedField.required.
 */
const REQUIRED_WORD =
  "required|mandatory|obligatory|obligatoriskt|obligatorisk|obligatoire|obligatorio|obrigat[oó]rio|obbligatorio|pflichtfeld|erforderlich|verpflichtend|verplicht|pakollinen|wymagane|n[eé]cessaire|must\\s+answer|must\\s+fill";

/**
 * Strip form-syntax decorations so Need You / fill UI show the real question only.
 */
export function stripFormSyntaxDecorators(value: string): string {
  let text = value;

  // Glued or wrapped required markers: ***Obligatoriskt***, *Required*, (required)
  text = text.replace(new RegExp(`\\*{1,6}\\s*(?:${REQUIRED_WORD})\\s*\\*{0,6}`, "gi"), " ");
  text = text.replace(new RegExp(`[\\[\\(]\\s*(?:${REQUIRED_WORD})\\s*[\\]\\)]`, "gi"), " ");
  text = text.replace(new RegExp(`(?:^|[\\s:;\\-–—])(?:${REQUIRED_WORD})\\s*$`, "gi"), " ");
  text = text.replace(new RegExp(`^(?:${REQUIRED_WORD})\\s*[:.\\-–—]?\\s*`, "gi"), " ");

  // Trailing / leading asterisk runs and orphan required badges
  text = text.replace(/\*{1,6}/g, " ");
  text = text.replace(/\s*[•·]\s*$/g, " ");

  // Google Forms style "Required question" / "This is a required question" alone
  if (new RegExp(`^(?:this\\s+is\\s+a\\s+)?(?:${REQUIRED_WORD})(?:\\s+question)?\\.?$`, "i").test(text.trim())) {
    return "";
  }

  return collapseWhitespace(text);
}

/** True when leftover chrome still looks like ATS required syntax after a first pass. */
export function looksLikeFormSyntaxNoise(value: string): boolean {
  const text = collapseWhitespace(value);
  if (!text) return false;
  if (/\*{2,}/.test(text)) return true;
  if (new RegExp(`(?:^|\\W)(?:${REQUIRED_WORD})(?:\\W|$)`, "i").test(text) && text.length < 40) return true;
  if (new RegExp(`\\S+(?:\\*{1,6}|\\s)(?:${REQUIRED_WORD})\\s*$`, "i").test(text)) return true;
  return false;
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
 * Prefer visible question copy; never surface raw Mongo/hex ids or required-field chrome.
 */
export function humanQuestionLabel(
  field: Pick<DetectedField, "label" | "nearbyText" | "ariaLabel" | "placeholder" | "name" | "id" | "key">,
): string {
  const candidates = [field.label, field.nearbyText, field.ariaLabel, field.placeholder]
    .map((item) => stripFormSyntaxDecorators(collapseWhitespace(item ?? "")))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (!isMachineFieldToken(candidate) && candidate.length >= 2) {
      return candidate.slice(0, 200);
    }
  }

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
  if (/share[-_]?link|copy[-_]?link|invite[-_]?token/i.test(blob)) {
    const question = humanQuestionLabel(field);
    if (question === "Form question" || isMachineFieldToken(question) || /^share\s*link$/i.test(question)) {
      return true;
    }
  }
  const question = humanQuestionLabel(field);
  if (question === "Form question" && isMachineFieldToken(field.key) && isMachineFieldToken(field.name || field.id)) {
    return true;
  }
  return false;
}
