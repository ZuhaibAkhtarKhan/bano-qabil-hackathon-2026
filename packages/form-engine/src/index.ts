export type { ApprovalState, DetectedField, FieldAttachment, FieldMapping, FieldMappingOption, FieldType, FillAction, MemoryValue, PageHazards } from "./types";
export type { ActionControlKind } from "./step-controls";
export { FIELD_TYPES, fieldSignals } from "./types";
export { fillTargetAllowed, isCaptchaChallengeCopy, isForbiddenFillAction, isProtectedControl, isSensitiveField, proposedFillTargets } from "./safety";
export {
  APPLY_BATCH_ID_ATTR,
  fieldsEligibleForBatch,
  isBatchEligibleField,
  stableBatchFieldId,
  stampBatchFieldIds,
  toBatchFieldInputs,
  toBatchFieldType,
  type BatchFieldExtras,
  type BatchFieldInput,
  type BatchFieldType,
} from "./batch-fill";
export { detectAccountCreation, detectCaptcha, detectUnsupportedForm, inspectPage } from "./hazards";
export { inventoryFromDocument, APPLY_FIELD_ATTR, APPLY_EMPTY_ATTR, APPLY_HOST_ATTR } from "./detect";
export { humanQuestionLabel, humanizeFieldToken, isMachineFieldToken, isNoiseFormField, looksLikeFormSyntaxNoise, stripFormSyntaxDecorators } from "./question-label";
export { mapField, mapFields, isAiAnswerableField, inferYesNoFromMemory, memoryChoiceScore, isJudgmentYesNoQuestion, shouldDeferYesNoToUserOrLlm } from "./mapping";
export {
  classifyActionControl,
  controlSignalText,
  findPrimaryStepAdvance,
  findPrimarySubmitControl,
  findStepAdvanceControls,
  isStepAdvanceControl,
  isSubmitControl,
} from "./step-controls";
export { deriveYearOfStudy, formatIdentityNumberForField, extractYearsFromText, toHtmlDateValue, valueFitsNativeInput } from "./format-value";
export {
  detectFieldLengthLimit,
  enforceFieldLengthLimit,
  describeFieldLengthLimit,
  type FieldLengthLimit,
} from "./field-limits";
export { assertFillActionAllowed, mappingsReadyToAutoFill, mappingsSafeToFill, planAutofill, type FillResult } from "./autofill";
