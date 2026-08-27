export const FIELD_TYPES = [
  "text",
  "textarea",
  "select",
  "radio",
  "checkbox",
  "date",
  "number",
  "url",
  "file",
  "multi-select",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type DetectedField = {
  key: string;
  name: string;
  id: string;
  label: string;
  placeholder: string;
  ariaLabel: string;
  nearbyText: string;
  type: FieldType;
  inputType: string;
  options: string[];
  required: boolean;
  autocomplete: string;
  signals: string;
};

export type PageHazards = {
  captcha: boolean;
  captchaVendor: string | null;
  captchaMessage: string | null;
  accountCreation: boolean;
  accountMessage: string | null;
  unsupported: boolean;
  unsupportedReason: string | null;
  hasSubmitControl: boolean;
};

export type MemoryValue = {
  path: string;
  source: string;
  value: string;
  aliases: string[];
};

export type ApprovalState = "pending" | "approved" | "rejected" | "blocked";

export type FieldMappingOption = {
  value: string;
  label: string;
  source: string;
};

export type FieldAttachment = {
  documentId: string;
  versionId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
};

export type FieldMapping = {
  fieldKey: string;
  label: string;
  memoryPath: string;
  source: string;
  confidence: number;
  proposedValue: string;
  /** Primary first; length > 1 means the page chip can offer alternates. */
  options: FieldMappingOption[];
  approvalState: ApprovalState;
  sensitive: boolean;
  excludedByDefault: boolean;
  reason: string;
  fieldType: FieldType;
  /** Open-ended question that can be drafted from memory / AI. */
  aiAnswerable: boolean;
  /** Show the Grammarly-style chip even when only one draft exists. */
  showChip: boolean;
  /** Present when this mapping attaches a vault document to a file input. */
  attachment?: FieldAttachment | null;
};

export type FillAction = "setValue" | "submit" | "clickSubmit" | "clickNext" | "bypassCaptcha" | "createAccount";

export function fieldSignals(field: Pick<DetectedField, "name" | "id" | "label" | "placeholder" | "ariaLabel" | "nearbyText" | "type" | "autocomplete">): string {
  return [field.label, field.name, field.id, field.placeholder, field.ariaLabel, field.nearbyText, field.type, field.autocomplete]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
