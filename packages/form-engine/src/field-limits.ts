/** Detect word/character limits from the control or surrounding form copy. */

export type FieldLengthLimit = {
  value: number;
  unit: "words" | "characters";
  source: "maxlength" | "label" | "counter";
};

function parsePositiveInt(raw: string | number | null | undefined): number | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n >= 100_000) return null;
  return Math.floor(n);
}

export function detectFieldLengthLimit(
  el: Element,
  label = "",
  nearby = "",
): FieldLengthLimit | null {
  const input = el as HTMLInputElement | HTMLTextAreaElement;
  const attrMax = input.getAttribute?.("maxlength") ?? input.getAttribute?.("maxLength");
  const maxLength = parsePositiveInt(
    typeof input.maxLength === "number" && input.maxLength > 0 ? input.maxLength : attrMax,
  );
  // Browsers report maxlength=-1 when unset; ignore huge defaults.
  if (maxLength && maxLength < 50_000) {
    return { value: maxLength, unit: "characters", source: "maxlength" };
  }

  const card = el.closest('[role="listitem"]') || el.closest("fieldset") || el.parentElement;
  const cardText = (card?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 800);
  const blob = `${label} ${nearby} ${el.getAttribute("aria-description") ?? ""} ${el.getAttribute("aria-label") ?? ""} ${cardText}`;

  const wordPatterns = [
    /(?:max(?:imum)?|limit(?:ed)?\s*(?:to|of)?|up\s*to|no\s*more\s*than|not\s*more\s*than|within)\s*(\d{1,5})\s*words?\b/i,
    /\b(\d{1,5})\s*words?\s*(?:max(?:imum)?|limit|or\s*less|allowed|only)?\b/i,
    /word\s*limit\s*[:=]?\s*(\d{1,5})\b/i,
  ];
  for (const pattern of wordPatterns) {
    const match = blob.match(pattern);
    const value = parsePositiveInt(match?.[1]);
    if (value) return { value, unit: "words", source: "label" };
  }

  const charPatterns = [
    /(?:max(?:imum)?|limit(?:ed)?\s*(?:to|of)?|up\s*to|no\s*more\s*than)\s*(\d{1,6})\s*(?:characters?|chars?)\b/i,
    /\b(\d{1,6})\s*(?:characters?|chars?)\s*(?:max(?:imum)?|limit|or\s*less)?\b/i,
    /character\s*limit\s*[:=]?\s*(\d{1,6})\b/i,
  ];
  for (const pattern of charPatterns) {
    const match = blob.match(pattern);
    const value = parsePositiveInt(match?.[1]);
    if (value) return { value, unit: "characters", source: "label" };
  }

  // Google Forms / portals: "0 / 200" near the field.
  const counter = cardText.match(/\b(\d{1,6})\s*\/\s*(\d{1,6})\b/);
  const counterMax = parsePositiveInt(counter?.[2]);
  if (counterMax) {
    if (/\bwords?\b/i.test(cardText.slice(Math.max(0, (counter?.index ?? 0) - 40), (counter?.index ?? 0) + 40))) {
      return { value: counterMax, unit: "words", source: "counter" };
    }
    return { value: counterMax, unit: "characters", source: "counter" };
  }

  return null;
}

export function enforceFieldLengthLimit(text: string, limit: FieldLengthLimit | null | undefined): string {
  const trimmed = text.trim();
  if (!limit || !trimmed) return trimmed;
  if (limit.unit === "words") {
    const words = trimmed.split(/\s+/);
    if (words.length <= limit.value) return trimmed;
    return words.slice(0, limit.value).join(" ");
  }
  if (trimmed.length <= limit.value) return trimmed;
  return trimmed.slice(0, limit.value).trimEnd();
}

export function describeFieldLengthLimit(limit: FieldLengthLimit | null | undefined): string {
  if (!limit) return "";
  return `Max ${limit.value} ${limit.unit}`;
}
