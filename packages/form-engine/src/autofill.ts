import { isForbiddenFillAction } from "./safety";
import type { FieldMapping, FillAction } from "./types";

/** Values the extension may write without per-field approval checkboxes. */
export function mappingsReadyToAutoFill(mappings: FieldMapping[]): FieldMapping[] {
  return mappings.filter((mapping) => {
    if (mapping.approvalState === "blocked") return false;
    if (mapping.sensitive) return false;
    if (mapping.memoryPath === "Blocked") return false;
    if (mapping.fieldType === "file") {
      return Boolean(mapping.attachment?.versionId || mapping.proposedValue);
    }
    if (!mapping.proposedValue) return false;
    return true;
  });
}

/** @deprecated Prefer mappingsReadyToAutoFill — kept for callers that still gate on approvalState. */
export function mappingsSafeToFill(mappings: FieldMapping[]): FieldMapping[] {
  return mappings.filter((mapping) => {
    if (mapping.approvalState !== "approved") return false;
    if (mapping.excludedByDefault && mapping.approvalState !== "approved") return false;
    if (mapping.sensitive && mapping.approvalState !== "approved") return false;
    if (mapping.memoryPath === "Blocked") return false;
    if (mapping.fieldType === "file") {
      return Boolean(mapping.attachment?.versionId || mapping.proposedValue);
    }
    if (!mapping.proposedValue) return false;
    return true;
  });
}

export function assertFillActionAllowed(action: FillAction, options?: { hostSubmitAllowed?: boolean }): void {
  if (isForbiddenFillAction(action, options)) {
    throw new Error("1-Apply never submits, bypasses CAPTCHA, or creates host accounts.");
  }
}

export type FillResult = {
  fieldKey: string;
  filled: boolean;
  value: string;
  skippedReason: string | null;
};

export function planAutofill(mappings: FieldMapping[]): { fill: FieldMapping[]; skipped: FillResult[] } {
  const fill = mappingsReadyToAutoFill(mappings);
  const skipped = mappings
    .filter((mapping) => !fill.includes(mapping))
    .map((mapping) => ({
      fieldKey: mapping.fieldKey,
      filled: false,
      value: "",
      skippedReason: mapping.reason,
    }));
  return { fill, skipped };
}
