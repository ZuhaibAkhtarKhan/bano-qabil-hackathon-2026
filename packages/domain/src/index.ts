export {
  computeFitIndex,
  eligibleEvidence,
  evaluateEligibility,
  evaluateRequirement,
  rankEvidenceForQuestion,
  rankResumes,
  tokenize,
  overlapScore,
  classifyRequirementKind,
  classifyResumeTrack,
  FIT_INDEX_WEIGHTS,
  ELIGIBILITY_DISPLAY,
  type EligibilityVerdict,
  type EligibilityState,
  type EligibilityDisplayState,
  type FitIndexInput,
  type FitIndexResult,
  type MemoryEvidence,
  type MemoryRequirement,
  type ResumeCandidate,
  type CandidateProfile,
} from "./matching";

export { finalizeGroundedDraft, freezeSubmissionManifest, lengthWarnings } from "./grounding";

export {
  MEMORY_SECTIONS,
  assertOwnedMemory,
  categoryFromKind,
  detectMemoryConflicts,
  memoryFactKey,
  normalizeFactValue,
  normalizeMemoryToken,
  pickCanonicalFact,
  type ConflictCandidate,
  type DetectedConflict,
} from "./memory";

export {
  evaluateSubmissionGuard,
  type CheckResult,
  type SubmissionCheckKind,
  type SubmissionGuardResult,
  type SubmissionInput,
} from "./submission-guard";

export {
  computeDeadlineInfo,
  DEFAULT_AUTO_SUBMIT_POLICY,
  evaluateAutoSubmit,
  generateReminder,
  prioritizeApplications,
  type AutoSubmitDecision,
  type AutoSubmitPolicy,
  type DeadlineInfo,
  type DeadlineUrgency,
  type NotificationState,
  type Reminder,
  type ReminderInput,
} from "./deadline-intelligence";

export {
  classifyEmail,
  associateEmailToApplication,
  buildProposedCalendarEvent,
  type ApplicationCandidate,
  type AssociationResult,
  type AssociationSignal,
  type CalendarEventInput,
  type EmailCategory,
  type EmailClassification,
  type EmailSignal,
  type ProposedCalendarEvent,
} from "./email-intelligence";
