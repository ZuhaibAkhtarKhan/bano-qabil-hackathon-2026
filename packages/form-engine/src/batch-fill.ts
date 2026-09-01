import { isProtectedControl, isSensitiveField } from "./safety";
import { APPLY_FIELD_ATTR } from "./detect";
import type { DetectedField, FieldType } from "./types";

export const APPLY_BATCH_ID_ATTR = "data-1apply-batch-id";

export type BatchFieldType = "text" | "textarea" | "select" | "radio" | "checkbox" | "file" | "contenteditable" | "date" | "number" | "url";

export type BatchFieldInput = {
  fieldId: string;
  type: BatchFieldType;
  label: string;
  name?: string;
  options?: string[];
  required?: boolean;
  maxLength?: number;
  currentValue?: string;
  nearbyText?: string;
  placeholder?: string;
  ariaLabel?: string;
};

export type BatchFieldExtras = {
  currentValue?: string;
  maxLength?: number;
};

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

/** Stable per name/id/key so DOM reorder does not change the round-trip id. */
export function stableBatchFieldId(field: Pick<DetectedField, "key" | "name" | "id">): string {
  return `f_${fnv1aHex(`${field.key}\0${field.name}\0${field.id}`)}`;
}

export function isBatchEligibleField(field: DetectedField): boolean {
  return !isProtectedControl(field) && !isSensitiveField(field);
}

/** Sensitive and blocked controls are dropped before any batch JSON is built. */
export function fieldsEligibleForBatch(fields: DetectedField[]): DetectedField[] {
  return fields.filter(isBatchEligibleField);
}

export function toBatchFieldType(type: FieldType, inputType = ""): BatchFieldType {
  if (type === "file") return "file";
  if (type === "radio") return "radio";
  if (type === "checkbox") return "checkbox";
  if (type === "select" || type === "multi-select") return "select";
  if (type === "textarea") return "textarea";
  if (type === "date" || inputType === "date" || inputType === "datetime-local" || inputType === "month") return "date";
  if (type === "number" || inputType === "number" || inputType === "range") return "number";
  if (type === "url" || inputType === "url") return "url";
  if (inputType === "contenteditable" || (type === "text" && inputType === "contenteditable")) {
    return "contenteditable";
  }
  return "text";
}

export function toBatchFieldInputs(
  fields: DetectedField[],
  extrasByKey: Record<string, BatchFieldExtras> = {},
): BatchFieldInput[] {
  return fieldsEligibleForBatch(fields).map((field) => {
    const extras = extrasByKey[field.key] ?? {};
    const input: BatchFieldInput = {
      fieldId: stableBatchFieldId(field),
      type: toBatchFieldType(field.type, field.inputType),
      label: field.label || field.name || field.key,
    };
    if (field.name) input.name = field.name;
    if (field.options.length) input.options = field.options;
    if (field.required) input.required = true;
    if (extras.maxLength && extras.maxLength > 0) input.maxLength = extras.maxLength;
    if (extras.currentValue?.trim()) input.currentValue = extras.currentValue.trim();
    if (field.nearbyText?.trim()) input.nearbyText = field.nearbyText.trim().slice(0, 240);
    if (field.placeholder?.trim()) input.placeholder = field.placeholder.trim().slice(0, 120);
    if (field.ariaLabel?.trim()) input.ariaLabel = field.ariaLabel.trim().slice(0, 180);
    return input;
  });
}

export function stampBatchFieldIds(root: ParentNode, fields: DetectedField[]): void {
  for (const field of fieldsEligibleForBatch(fields)) {
    const fieldId = stableBatchFieldId(field);
    const selector = `[${APPLY_FIELD_ATTR}="${cssEscape(field.key)}"]`;
    const nodes =
      "querySelectorAll" in root
        ? Array.from((root as Document | Element).querySelectorAll(selector))
        : [];
    for (const node of nodes) {
      node.setAttribute(APPLY_BATCH_ID_ATTR, fieldId);
    }
  }
}
