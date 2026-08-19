export type { ApprovalState, DetectedField, FieldMapping, FieldType, FillAction, MemoryValue, PageHazards } from "./types";
export { FIELD_TYPES, fieldSignals } from "./types";
export { fillTargetAllowed, isForbiddenFillAction, isProtectedControl, isSensitiveField, proposedFillTargets } from "./safety";
export { detectAccountCreation, detectCaptcha, detectUnsupportedForm, inspectPage } from "./hazards";
export { inventoryFromDocument } from "./detect";
export { mapField, mapFields } from "./mapping";
export { assertFillActionAllowed, mappingsSafeToFill, planAutofill, type FillResult } from "./autofill";
