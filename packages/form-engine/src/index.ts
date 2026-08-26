export type { ApprovalState, DetectedField, FieldAttachment, FieldMapping, FieldMappingOption, FieldType, FillAction, MemoryValue, PageHazards } from "./types";
export { FIELD_TYPES, fieldSignals } from "./types";
export { fillTargetAllowed, isForbiddenFillAction, isProtectedControl, isSensitiveField, proposedFillTargets } from "./safety";
export { detectAccountCreation, detectCaptcha, detectUnsupportedForm, inspectPage } from "./hazards";
export { inventoryFromDocument, APPLY_FIELD_ATTR, APPLY_EMPTY_ATTR, APPLY_HOST_ATTR } from "./detect";
export { humanQuestionLabel, humanizeFieldToken, isMachineFieldToken, isNoiseFormField } from "./question-label";
export { mapField, mapFields, isAiAnswerableField, inferYesNoFromMemory, memoryChoiceScore } from "./mapping";
export { deriveYearOfStudy, formatIdentityNumberForField, extractYearsFromText } from "./format-value";
export {
  detectFieldLengthLimit,
  enforceFieldLengthLimit,
  describeFieldLengthLimit,
  type FieldLengthLimit,
} from "./field-limits";
export { assertFillActionAllowed, mappingsReadyToAutoFill, mappingsSafeToFill, planAutofill, type FillResult } from "./autofill";
