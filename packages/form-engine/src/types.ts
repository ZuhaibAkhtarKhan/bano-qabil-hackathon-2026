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

export type FieldMapping = {
  fieldKey: string;
  label: string;
  memoryPath: string;
  source: string;
  confidence: number;
  proposedValue: string;
  approvalState: ApprovalState;
  sensitive: boolean;
  excludedByDefault: boolean;
  reason: string;
  fieldType: FieldType;
};

export type FillAction = "setValue" | "submit" | "clickSubmit" | "bypassCaptcha" | "createAccount";

export function fieldSignals(field: Pick<DetectedField, "name" | "id" | "label" | "placeholder" | "ariaLabel" | "nearbyText" | "type" | "autocomplete">): string {
  return [field.label, field.name, field.id, field.placeholder, field.ariaLabel, field.nearbyText, field.type, field.autocomplete]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
