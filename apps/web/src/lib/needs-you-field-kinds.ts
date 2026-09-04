/** Helpers for Needs You input kinds derived from scraped form field_mappings. */

import { isJudgmentYesNoQuestion } from "@1apply/form-engine";

export function isImageUploadRequest(label: string, accept = ""): boolean {
  return /image|photo|headshot|portrait|profile\s*pic|\bpic\b|jpeg|jpg|png|webp|gif/i.test(
    `${label} ${accept}`,
  );
}

export function choiceValuesFromMappingOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  const values: string[] = [];
  for (const item of options) {
    if (typeof item === "string" && item.trim()) {
      values.push(item.trim());
      continue;
    }
    if (item && typeof item === "object" && "value" in item) {
      const value = String((item as { value?: unknown }).value ?? "").trim();
      if (value) values.push(value);
    }
  }
  return [...new Set(values)].slice(0, 80);
}

export const DEFAULT_YES_NO_OPTIONS = ["Yes", "No"] as const;

export const CHOICE_FIELD_TYPES = new Set([
  "select",
  "radio",
  "checkbox",
  "multi-select",
]);

export function isChoiceFieldType(fieldType: string | null | undefined): boolean {
  return CHOICE_FIELD_TYPES.has(String(fieldType ?? "").trim().toLowerCase());
}

/**
 * Host Yes/No radios (commitment / availability) — select, not open text.
 * Open prompts that ask for links/examples/essays stay free-text.
 */
export function looksLikeYesNoChoiceQuestion(label: string): boolean {
  const text = label.trim();
  if (!text) return false;
  if (
    /\b(share|describe|explain|list|tell us|why do you|why are you|links?|examples?|essay|in your own words|write about)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  if (isJudgmentYesNoQuestion(text)) return true;
  if (/\b(yes\s*\/\s*no|yes\s+or\s+no|y\s*\/\s*n)\b/i.test(text)) return true;
  if (
    text.length <= 180 &&
    /\?\s*$/.test(text) &&
    /^(can you|will you|would you|are you|is there|do you|did you|have you)\b/i.test(text)
  ) {
    return true;
  }
  return false;
}

export type NeedsYouFieldType =
  | "text"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "date"
  | "number"
  | "url"
  | "file"
  | "multi-select"
  | "email"
  | "tel";

export function normalizeNeedsYouFieldType(raw: string | null | undefined): NeedsYouFieldType | null {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!value) return null;
  if (
    value === "text" ||
    value === "textarea" ||
    value === "select" ||
    value === "radio" ||
    value === "checkbox" ||
    value === "date" ||
    value === "number" ||
    value === "url" ||
    value === "file" ||
    value === "multi-select" ||
    value === "email" ||
    value === "tel"
  ) {
    return value;
  }
  return null;
}

/** UUID / version-id style values from document enrichment — not human choice labels. */
export function looksLikeVaultId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

/** Kit chip / evidence blobs wrongly stored in field_mappings.options for open text. */
export function looksLikeKitEvidenceOption(value: string): boolean {
  const text = value.trim();
  if (!text) return true;
  if (looksLikeVaultId(text)) return true;
  if (text.length > 160) return true;
  return /^(education|project|certification|leadership|achievement|employment|evidence|skill|experience)\b/i.test(
    text,
  );
}

/**
 * Form choice options for Need You selects.
 * Only host select/radio/checkbox options — never kit chip suggestions for essays.
 */
export function resolveNeedsYouChoiceOptions(input: {
  label: string;
  fieldType?: string | null;
  mappingOptions?: unknown;
}): string[] {
  const fieldType = normalizeNeedsYouFieldType(input.fieldType);

  // Open / typed / file fields never become selects from stored options.
  if (
    fieldType === "text" ||
    fieldType === "textarea" ||
    fieldType === "url" ||
    fieldType === "number" ||
    fieldType === "date" ||
    fieldType === "email" ||
    fieldType === "tel" ||
    fieldType === "file"
  ) {
    return [];
  }

  if (isChoiceFieldType(fieldType)) {
    const fromMapping = choiceValuesFromMappingOptions(input.mappingOptions).filter(
      (value) => !looksLikeVaultId(value) && !looksLikeKitEvidenceOption(value),
    );
    if (fromMapping.length > 0) return fromMapping;
    if (looksLikeYesNoChoiceQuestion(input.label)) return [...DEFAULT_YES_NO_OPTIONS];
    return [];
  }

  // No host field_type (opportunity answer / eligibility without mapping): Yes/No only when clearly binary.
  if (!fieldType && looksLikeYesNoChoiceQuestion(input.label)) {
    return [...DEFAULT_YES_NO_OPTIONS];
  }

  return [];
}

/** Map scraped host field_type → Need You control, matching the live form. */
export function inputTypeFromHostFieldType(
  fieldType: string | null | undefined,
  label: string,
  optionCount = 0,
): "text" | "textarea" | "date" | "datetime" | "select" | "multi-select" | "document" | "image" | "number" | "url" | "email" | "tel" | null {
  const type = normalizeNeedsYouFieldType(fieldType);
  if (type === "file") {
    return isImageUploadRequest(label) ? "image" : "document";
  }
  if (type === "textarea") return "textarea";
  if (type === "date") return "date";
  if (type === "number") return "number";
  if (type === "url") return "url";
  if (type === "email") return "email";
  if (type === "tel") return "tel";
  if (type === "multi-select") return "multi-select";
  // Google Forms checkbox groups are detected as checkbox with multiple option labels.
  if (type === "checkbox" && optionCount > 1) return "multi-select";
  if (type === "select" || type === "radio" || type === "checkbox") return "select";
  if (type === "text") return "text";
  return null;
}

/** Split a stored multi-select value back into checked option labels. */
export function parseNeedsYouMultiValues(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/\n|;/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Join multi-select choices for storage / extension fill (matches content script splitter). */
export function joinNeedsYouMultiValues(values: string[]): string {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].join("; ");
}

/** Pick the host option that matches a Need You / stored answer, keeping live form wording. */
export function snapToHostOption(value: string, options: string[] | null | undefined): string | null {
  const wanted = value.trim();
  if (!wanted) return null;
  if (!options?.length) return wanted;

  const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
  const wantedN = norm(wanted);
  const exact = options.find((option) => norm(option) === wantedN);
  if (exact) return exact;

  const parts = wanted.split(/\n|;/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    const snapped = parts
      .map((part) => snapToHostOption(part, options))
      .filter((part): part is string => Boolean(part));
    if (snapped.length) return [...new Set(snapped)].join("; ");
  }

  let best: { option: string; score: number } | null = null;
  for (const option of options) {
    const optionN = norm(option);
    if (!optionN) continue;
    let score = 0;
    if (optionN.includes(wantedN) || wantedN.includes(optionN)) {
      score = Math.min(optionN.length, wantedN.length) / Math.max(optionN.length, wantedN.length);
    }
    if (score >= 0.35 && (!best || score > best.score)) {
      best = { option, score };
    }
  }
  if (best && best.score >= 0.45) {
    // Prefer the applicant's short label when the captured option is a concatenated blob.
    if (wantedN.length >= 2 && wantedN.length <= 48 && norm(best.option).includes(wantedN) && norm(best.option).length > wantedN.length + 8) {
      return wanted;
    }
    return best.option;
  }
  return wanted;
}

/** Options persisted on field_mappings — only real form choices. */
export function persistableFormChoiceOptions(input: {
  fieldType: string | null | undefined;
  hostOptions?: string[] | null;
  mappingOptionValues?: string[] | null;
}): string[] {
  if (!isChoiceFieldType(input.fieldType)) return [];
  const host = (input.hostOptions ?? []).map((item) => item.trim()).filter(Boolean);
  if (host.length > 0) return [...new Set(host)].slice(0, 80);
  const fromMapping = (input.mappingOptionValues ?? []).filter(
    (value) => value.trim() && !looksLikeVaultId(value) && !looksLikeKitEvidenceOption(value),
  );
  return [...new Set(fromMapping)].slice(0, 80);
}

export function formatNeedsYouDocumentOption(doc: {
  label: string;
  type?: string | null;
  versionLabel?: string | null;
  categoryLabel?: string | null;
  fileName?: string | null;
}): string {
  const parts = [doc.label.trim() || "Document"];
  if (doc.versionLabel?.trim()) parts.push(doc.versionLabel.trim());
  if (doc.categoryLabel?.trim()) parts.push(doc.categoryLabel.trim());
  else if (doc.type?.trim() && !/^(other|supporting_document)$/i.test(doc.type)) {
    parts.push(doc.type.replace(/_/g, " "));
  }
  if (doc.fileName?.trim() && doc.fileName.trim() !== doc.label.trim()) {
    parts.push(doc.fileName.trim());
  }
  return parts.join(" · ");
}
