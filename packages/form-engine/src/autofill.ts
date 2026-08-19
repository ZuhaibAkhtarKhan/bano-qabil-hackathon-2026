import { isForbiddenFillAction } from "./safety";
import type { FieldMapping, FillAction } from "./types";

export function mappingsSafeToFill(mappings: FieldMapping[]): FieldMapping[] {
  return mappings.filter((mapping) => {
    if (mapping.approvalState !== "approved") return false;
    if (mapping.excludedByDefault && mapping.approvalState !== "approved") return false;
    if (mapping.sensitive && mapping.approvalState !== "approved") return false;
    if (!mapping.proposedValue) return false;
    if (mapping.fieldType === "file") return false;
    if (mapping.memoryPath === "Blocked") return false;
    return true;
  });
}

export function assertFillActionAllowed(action: FillAction): void {
  if (isForbiddenFillAction(action)) {
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
  const fill = mappingsSafeToFill(mappings);
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
