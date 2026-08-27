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
  ELIGIBILITY_LABELS,
  RESUME_FOCUSES,
  classifyOpportunityFocus,
  classifyResumeFocus,
  eligibilityFactorScore,
  eligibilityLabel,
  explainFitScore,
  extractYears,
  inferRequirementKind,
  reconstructFitScore,
  selectEvidenceForRequirement,
  type EligibilityContext,
  type EligibilityVerdict,
  type EligibilityState,
  type EligibilityDisplayState,
  type FitFactor,
  type FitIndexInput,
  type FitIndexResult,
  type MemoryEvidence,
  type MemoryRequirement,
  type RankedResume,
  type ResumeCandidate,
  type CandidateProfile,
} from "./matching";

export {
  buildAutoResumeSelection,
  inferOpportunityCategoryKeys,
  type AutoResumeSelection,
  type AutoResumeStrategy,
  type CategorizedResume,
} from "./resume-auto-select";

export { finalizeGroundedDraft, freezeSubmissionManifest, lengthWarnings } from "./grounding";

export {
  detectSubmissionSignals,
  type SubmissionSignalResult,
} from "./submission-signals";

export {
  buildAnswerPrompt,
  classifyQuestion,
  extractClaims,
  groundingScore,
  rankEvidenceForAnswer,
  toneInstruction,
  validateClaims,
  type AnswerState,
  type ClaimFlag,
  type GenerationIntent,
  type QuestionKind,
  type ToneStyle,
} from "./answer-generation";

export {
  MEMORY_SECTIONS,
  assertOwnedMemory,
  categoryFromKind,
  detectMemoryConflicts,
  evidenceIdentityKey,
  memoryFactKey,
  normalizeFactValue,
  normalizeMemoryToken,
  normalizeOrganizationToken,
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
  SILENCE_AUTO_SUBMIT_POLICY,
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
  currentGuideStep,
  nextGuideSteps,
  type GuideStep,
} from "./guide";

export {
  classifyPendingPacket,
  classifyRequiredDocumentLabel,
  classifyVaultDocument,
  CNIC_PHARM_B_LABEL,
  kitStatus,
  matchVaultDocument,
  packetAnswerText,
  packetSummary,
  planKitAttachments,
  requiredDocumentCovered,
  type KitDocumentKind,
  type KitStatus,
  type PacketAnswer,
  type PacketLane,
  type PendingPacketInput,
  type VaultDocument,
} from "./kit";

export {
  RESUME_CATEGORY_PRESETS,
  resolveResumeCategory,
  resumeCategoryDisplayLabel,
  type ResolvedResumeCategory,
  type ResumeCategoryPresetKey,
} from "./resume-categories";

export {
  deduplicateDiscoveries,
  emptyDiscoveryCriteria,
  filterDiscoveries,
  mergeDiscoveryCriteria,
  normalizeOpportunityUrl,
  parseDiscoveryCriteria,
  rankDiscoveries,
  runDiscoveryPipeline,
  type DiscoveryCandidate,
  type DiscoveryCriteria,
  type DiscoveryPreferences,
  type EducationLevel,
  type ExperienceLevel,
  type RankedDiscovery,
} from "./discovery";

export {
  matchApplicationByUrl,
  scoreUrlMatch,
  urlsLikelySame,
  type UrlMatchableApplication,
} from "./url-match";

export { sourcedDiscoveryCatalog } from "./discovery-catalog";

export {
  PERSONA_IDS,
  PERSONA_PRESETS,
  parsePersona,
  personaBoostKinds,
  type PersonaId,
  type PersonaPreset,
} from "./persona";

export {
  suggestPreviousAnswers,
  type PreviousAnswerCandidate,
  type RankedPreviousAnswer,
} from "./previous-answers";

export { notificationDraftFromEvent, notificationIdempotencyKey, NOTIFICATION_CATEGORIES, DOMAIN_EVENT_NAMES, type DomainEvent, type DomainEventName, type NotificationCategory, type NotificationDraft, type NotificationPriority } from "./notifications";

export { planAutomation, AUTOMATION_KINDS, type AutomationDecision, type AutomationKind, type ApplicationAutomationSnapshot } from "./automation";

export { assessOperatingLoop, loopContinuity, OPERATING_LOOP_STAGES, type LoopStageResult, type OperatingLoopSnapshot } from "./operating-loop";

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
