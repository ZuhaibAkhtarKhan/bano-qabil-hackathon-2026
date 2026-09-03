export type NotificationState =
  | "incomplete"
  | "deadline_approaching"
  | "human_action_required"
  | "answer_required"
  | "document_required"
  | "submission_ready"
  | "submission_completed"
  | "submission_failed";

export type DeadlineUrgency = "none" | "upcoming" | "soon" | "imminent" | "overdue";

export type DeadlineInfo = {
  deadlineAt: string | null;
  deadlineTimezone: string | null;
  hoursRemaining: number | null;
  urgency: DeadlineUrgency;
  label: string;
};

export type ReminderInput = {
  applicationTitle: string;
  organization: string | null;
  deadlineAt: string | null;
  deadlineTimezone: string | null;
  completenessPercent: number;
  totalQuestions: number;
  answeredQuestions: number;
  pendingDocuments: number;
  fitScore: number | null;
  status: string;
  submittedAt: string | null;
  hasCaptcha: boolean;
  hasSignature: boolean;
  hasPayment: boolean;
  unresolvedReviewCount: number;
  interviewDates: string[];
  contacts: string[];
  followUps: string[];
  prepareAndSendIfSilent?: boolean;
  packetSummary?: string;
  identityPresent?: boolean;
  packetNoticeSent?: boolean;
  allQuestionsHavePacketText?: boolean;
};

export type Reminder = {
  state: NotificationState;
  urgency: DeadlineUrgency;
  title: string;
  body: string;
  priority: number;
  actionable: boolean;
};

const CLOSED_STATUSES = new Set(["submitted", "rejected", "withdrawn", "archived", "offer"]);

export function computeDeadlineInfo(
  deadlineAt: string | null,
  deadlineTimezone: string | null,
  now: Date = new Date(),
): DeadlineInfo {
  if (!deadlineAt) {
    return { deadlineAt: null, deadlineTimezone, hoursRemaining: null, urgency: "none", label: "No deadline" };
  }

  const deadline = new Date(deadlineAt);
  if (isNaN(deadline.getTime())) {
    return { deadlineAt, deadlineTimezone, hoursRemaining: null, urgency: "none", label: "Invalid deadline" };
  }

  const ms = deadline.getTime() - now.getTime();
  const hours = ms / (1000 * 60 * 60);

  let urgency: DeadlineUrgency;
  if (hours < 0) urgency = "overdue";
  else if (hours < 24) urgency = "imminent";
  else if (hours < 72) urgency = "soon";
  else if (hours < 168) urgency = "upcoming";
  else urgency = "none";

  const label = formatDeadlineLabel(deadline, deadlineTimezone, hours);

  return {
    deadlineAt,
    deadlineTimezone,
    hoursRemaining: Math.round(hours * 10) / 10,
    urgency,
    label,
  };
}

function formatDeadlineLabel(deadline: Date, timezone: string | null, hours: number): string {
  const opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };
  if (timezone) opts.timeZone = timezone;

  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat("en", opts).format(deadline);
  } catch {
    formatted = deadline.toISOString();
  }

  if (hours < 0) return `Overdue since ${formatted}`;
  if (hours < 24) return `Due today: ${formatted}`;
  if (hours < 48) return `Due tomorrow: ${formatted}`;
  return `Deadline: ${formatted}`;
}

export function generateReminder(input: ReminderInput, now: Date = new Date()): Reminder | null {
  if (CLOSED_STATUSES.has(input.status)) return null;

  const deadline = computeDeadlineInfo(input.deadlineAt, input.deadlineTimezone, now);
  const title = input.applicationTitle;
  const org = input.organization ? ` at ${input.organization}` : "";

  if (input.hasCaptcha || input.hasSignature || input.hasPayment) {
    const actions: string[] = [];
    if (input.hasCaptcha) actions.push("CAPTCHA");
    if (input.hasSignature) actions.push("signature");
    if (input.hasPayment) actions.push("payment");
    return {
      state: "human_action_required",
      urgency: deadline.urgency,
      title: `${title}${org}: human action required`,
      body: `${actions.join(", ")} need${actions.length === 1 ? "s" : ""} your manual input. 1-Apply cannot handle ${actions.join("/")} for you.`,
      priority: deadline.urgency === "imminent" ? 100 : 90,
      actionable: true,
    };
  }

  const remainingQuestions = input.totalQuestions - input.answeredQuestions;

  if (remainingQuestions > 0 && deadline.urgency !== "none" && !input.prepareAndSendIfSilent) {
    return {
      state: "answer_required",
      urgency: deadline.urgency,
      title: `${title}${org}: ${remainingQuestions} question${remainingQuestions === 1 ? "" : "s"} remaining`,
      body: `Your application is ${input.completenessPercent}% complete. ${deadline.label}. ${remainingQuestions} question${remainingQuestions === 1 ? " needs" : "s need"} an approved answer.`,
      priority: priorityFromUrgency(deadline.urgency, 70),
      actionable: true,
    };
  }

  if (input.pendingDocuments > 0 && deadline.urgency !== "none") {
    return {
      state: "document_required",
      urgency: deadline.urgency,
      title: `${title}${org}: ${input.pendingDocuments} document${input.pendingDocuments === 1 ? "" : "s"} needed`,
      body: `Attach required documents before the deadline. ${deadline.label}.`,
      priority: priorityFromUrgency(deadline.urgency, 60),
      actionable: true,
    };
  }

  if (input.prepareAndSendIfSilent && (deadline.urgency === "imminent" || deadline.urgency === "soon" || deadline.urgency === "overdue")) {
    return {
      state: "deadline_approaching",
      urgency: deadline.urgency,
      title: `${title}${org}: will auto-submit unless you edit`,
      body: `Unless you edit, 1-Apply will fill and submit this form before the deadline. ${input.packetSummary ?? "Current answers and attached documents will be sent."} ${deadline.label}. CAPTCHA, signature, and payment still need you.`,
      priority: priorityFromUrgency(deadline.urgency, 90),
      actionable: true,
    };
  }

  if (
    remainingQuestions === 0 &&
    input.pendingDocuments === 0 &&
    input.unresolvedReviewCount === 0 &&
    input.completenessPercent >= 80
  ) {
    return {
      state: "submission_ready",
      urgency: deadline.urgency,
      title: `${title}${org}: ready to submit`,
      body: `Your application is ${input.completenessPercent}% complete. All questions answered, documents attached. ${deadline.label}. Review and mark submitted when you've sent it yourself.`,
      priority: priorityFromUrgency(deadline.urgency, 50),
      actionable: true,
    };
  }

  if (deadline.urgency === "imminent" || deadline.urgency === "soon") {
    return {
      state: "deadline_approaching",
      urgency: deadline.urgency,
      title: `${title}${org}: deadline approaching`,
      body: `${deadline.label}. Your application is ${input.completenessPercent}% complete.${remainingQuestions > 0 ? ` ${remainingQuestions} question${remainingQuestions === 1 ? "" : "s"} remaining.` : ""}`,
      priority: priorityFromUrgency(deadline.urgency, 80),
      actionable: true,
    };
  }

  if (input.completenessPercent < 50 && input.status !== "draft") {
    return {
      state: "incomplete",
      urgency: deadline.urgency,
      title: `${title}${org}: incomplete`,
      body: `Your application is only ${input.completenessPercent}% complete. ${deadline.label}.`,
      priority: 20,
      actionable: true,
    };
  }

  return null;
}

function priorityFromUrgency(urgency: DeadlineUrgency, base: number): number {
  switch (urgency) {
    case "overdue": return base + 30;
    case "imminent": return base + 25;
    case "soon": return base + 15;
    case "upcoming": return base + 5;
    default: return base;
  }
}

export type AutoSubmitPolicy = {
  enabled: boolean;
  allowAutoGenerate: boolean;
  requireAllAnswersApproved: boolean;
  silenceTreatsSuggestionsAsPacket: boolean;
  /** When true, only act at/after deadline (legacy freeze). When false, submit in the lead window before deadline. */
  freezeOnlyAtOrAfterDeadline: boolean;
  /** When true, queue a host form submit (extension / worker clicks Submit). */
  submitToHost: boolean;
  /** Submit when deadline is this many hours away or less (still before deadline). */
  submitLeadHours: number;
  requireIdentity: boolean;
  requirePriorPacketNotice: boolean;
  requireDocumentsAttached: boolean;
  requireFitScoreAbove: number | null;
  neverBypassCaptcha: true;
  neverBypassSignature: true;
  neverBypassPayment: true;
  neverBypassAuth: true;
  neverBypassLegalAttestation: true;
  boundedToDeadlineHours: number;
  auditTrail: true;
};

export const DEFAULT_AUTO_SUBMIT_POLICY: AutoSubmitPolicy = {
  enabled: false,
  allowAutoGenerate: false,
  requireAllAnswersApproved: true,
  silenceTreatsSuggestionsAsPacket: false,
  freezeOnlyAtOrAfterDeadline: false,
  submitToHost: false,
  submitLeadHours: 24,
  requireIdentity: false,
  requirePriorPacketNotice: false,
  requireDocumentsAttached: true,
  requireFitScoreAbove: 60,
  neverBypassCaptcha: true,
  neverBypassSignature: true,
  neverBypassPayment: true,
  neverBypassAuth: true,
  neverBypassLegalAttestation: true,
  boundedToDeadlineHours: 24,
  auditTrail: true,
};

export const PRE_DEADLINE_REVIEW_NOTICE_HOURS = 2;

/** Auto-submit runs this many hours before the deadline (after the review email window opens). */
export const HOST_AUTO_SUBMIT_BEFORE_DEADLINE_HOURS = 1;

/** How long after the deadline we still attempt a final one-shot host submit. */
export const HOST_POST_DEADLINE_RETRY_WINDOW_HOURS = 24;

export function computeHostSubmitDueAt(deadlineAt: string, now: Date = new Date()): Date {
  const deadline = new Date(deadlineAt);
  if (Number.isNaN(deadline.getTime())) return now;
  const oneHourBefore = new Date(deadline.getTime() - HOST_AUTO_SUBMIT_BEFORE_DEADLINE_HOURS * 60 * 60 * 1000);
  return oneHourBefore.getTime() > now.getTime() ? oneHourBefore : now;
}

/** One final attempt at/after the deadline if the form is still not submitted. */
export function computePostDeadlineHostSubmitDueAt(deadlineAt: string, now: Date = new Date()): Date {
  const deadline = new Date(deadlineAt);
  if (Number.isNaN(deadline.getTime())) return now;
  return deadline.getTime() > now.getTime() ? deadline : now;
}

export function postDeadlineHostSubmitIdempotencyKey(applicationId: string, deadlineAt: string): string {
  return `${applicationId}:host_submit:post_deadline:${deadlineAt}`;
}

export function isPostDeadlineHostSubmitKey(idempotencyKey: string | null | undefined): boolean {
  return Boolean(idempotencyKey && idempotencyKey.includes(":host_submit:post_deadline:"));
}

/** True when silence-send is on and the deadline is within the final review window (default 2h). */
export function shouldSendPreDeadlineReviewNotice(
  hoursRemaining: number | null,
  prepareAndSendIfSilent: boolean,
): boolean {
  if (!prepareAndSendIfSilent) return false;
  if (hoursRemaining === null) return false;
  return hoursRemaining > HOST_AUTO_SUBMIT_BEFORE_DEADLINE_HOURS && hoursRemaining <= PRE_DEADLINE_REVIEW_NOTICE_HOURS;
}

export function buildPreDeadlineReviewNotice(input: {
  applicationTitle: string;
  organization: string | null;
  deadlineLabel: string;
  packetSummary?: string;
  reviewUrl: string;
}): { title: string; body: string; emailSubject: string; emailHtml: string } {
  const org = input.organization ? ` at ${input.organization}` : "";
  const summary = input.packetSummary ? ` ${input.packetSummary}` : "";
  const title = `Review before auto-submit — ${input.applicationTitle}${org}`;
  const body = `The deadline is ${input.deadlineLabel}. 1-Apply already filled this form from your profile.${summary} Review and edit anything you want changed. Unless you update it, the form will auto-submit ${HOST_AUTO_SUBMIT_BEFORE_DEADLINE_HOURS} hour${HOST_AUTO_SUBMIT_BEFORE_DEADLINE_HOURS === 1 ? "" : "s"} before the deadline. CAPTCHA, signature, and payment still need you.`;
  const emailSubject = title;
  const emailHtml = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<p>${body.replace(/\n/g, "<br>")}</p>
<p><a href="${input.reviewUrl}" style="display:inline-block;padding:10px 16px;background:#0d9488;color:#fff;text-decoration:none;border-radius:8px">Review application</a></p>
<p style="color:#666;font-size:13px">You can also open Need You from your dashboard to fix anything still waiting on you.</p>
</body></html>`;
  return { title, body, emailSubject, emailHtml };
}

/** Default when user enables “prepare and send if silent” — submit to host before deadline. */
export const SILENCE_AUTO_SUBMIT_POLICY: AutoSubmitPolicy = {
  ...DEFAULT_AUTO_SUBMIT_POLICY,
  enabled: true,
  allowAutoGenerate: true,
  requireAllAnswersApproved: false,
  // Host submit uses Memory + Need You as-is; application-tab readiness is not a gate.
  silenceTreatsSuggestionsAsPacket: true,
  freezeOnlyAtOrAfterDeadline: false,
  submitToHost: true,
  submitLeadHours: HOST_AUTO_SUBMIT_BEFORE_DEADLINE_HOURS,
  requireIdentity: false,
  // Short deadlines (e.g. set 1 minute before) skip the review-email window.
  requirePriorPacketNotice: false,
  requireDocumentsAttached: false,
  requireFitScoreAbove: null,
};

export type AutoSubmitDecision = {
  action: "proceed" | "pause" | "block";
  reason: string;
  humanActionRequired: string[];
};

export function evaluateAutoSubmit(
  policy: AutoSubmitPolicy,
  input: ReminderInput & {
    allAnswersApproved: boolean;
    documentsAttached: boolean;
    hasUnsupportedClaims: boolean;
  },
  now: Date = new Date(),
): AutoSubmitDecision {
  if (!policy.enabled) {
    return { action: "block", reason: "Auto-submit is not enabled.", humanActionRequired: [] };
  }

  const humanActions: string[] = [];
  if (input.hasCaptcha) humanActions.push("Complete CAPTCHA manually");
  if (input.hasSignature) humanActions.push("Sign the document manually");
  if (input.hasPayment) humanActions.push("Complete payment manually");

  if (humanActions.length > 0) {
    return {
      action: "pause",
      reason: "Human action is required before submission can proceed. 1-Apply never bypasses CAPTCHA, signature, or payment.",
      humanActionRequired: humanActions,
    };
  }

  if (policy.requireIdentity && input.identityPresent === false) {
    return { action: "block", reason: "Identity is empty. Silence-send will not freeze an empty kit.", humanActionRequired: [] };
  }

  if (policy.requirePriorPacketNotice && !input.packetNoticeSent) {
    return { action: "block", reason: "Pre-deadline packet notice has not been sent yet.", humanActionRequired: [] };
  }

  if (policy.requireAllAnswersApproved && !input.allAnswersApproved) {
    // Host submit proceeds with Memory + Need You even when application-tab answers are incomplete.
    if (!policy.submitToHost) {
      const silenceReady = policy.silenceTreatsSuggestionsAsPacket && input.allQuestionsHavePacketText;
      if (!silenceReady) {
        return {
          action: "block",
          reason: `${input.totalQuestions - input.answeredQuestions} question(s) do not have approved answers.`,
          humanActionRequired: [],
        };
      }
    }
  }

  if (
    !policy.submitToHost &&
    policy.silenceTreatsSuggestionsAsPacket &&
    input.allQuestionsHavePacketText === false
  ) {
    return { action: "block", reason: "The packet is missing suggested or edited answers.", humanActionRequired: [] };
  }

  if (policy.requireDocumentsAttached && !input.documentsAttached) {
    return { action: "block", reason: "Required documents are not attached.", humanActionRequired: [] };
  }

  if (policy.requireFitScoreAbove != null && input.fitScore != null && input.fitScore < policy.requireFitScoreAbove) {
    return {
      action: "block",
      reason: `Fit score ${input.fitScore} is below the minimum ${policy.requireFitScoreAbove}.`,
      humanActionRequired: [],
    };
  }

  if (input.hasUnsupportedClaims) {
    return { action: "block", reason: "Unsupported eligibility claims exist.", humanActionRequired: [] };
  }

  const deadline = computeDeadlineInfo(input.deadlineAt, input.deadlineTimezone, now);
  if (deadline.hoursRemaining === null) {
    return {
      action: "block",
      reason: "No deadline is on file, so auto-submit cannot run.",
      humanActionRequired: [],
    };
  }

  if (policy.freezeOnlyAtOrAfterDeadline) {
    if (deadline.hoursRemaining > 0) {
      return { action: "block", reason: "Deadline has not been reached. The packet stays editable.", humanActionRequired: [] };
    }
  } else if (policy.submitToHost) {
    const leadHours = policy.submitLeadHours;
    if (deadline.hoursRemaining > leadHours) {
      return {
        action: "block",
        reason: `Deadline is ${Math.round(deadline.hoursRemaining)} hours away. Auto-submit is scheduled ${leadHours} hour${leadHours === 1 ? "" : "s"} before the deadline.`,
        humanActionRequired: [],
      };
    }
    if (deadline.hoursRemaining <= 0) {
      return {
        action: "proceed",
        reason: "Deadline passed. Submit to host now with the current packet.",
        humanActionRequired: [],
      };
    }
  } else if (deadline.hoursRemaining > policy.boundedToDeadlineHours) {
    return {
      action: "block",
      reason: `Deadline is ${Math.round(deadline.hoursRemaining)} hours away, outside the ${policy.boundedToDeadlineHours}-hour auto-submit window.`,
      humanActionRequired: [],
    };
  }

  return {
    action: "proceed",
    reason: policy.submitToHost
      ? "Within the pre-deadline window. Queue host form fill and submit."
      : policy.freezeOnlyAtOrAfterDeadline
        ? "Deadline reached. Freeze the current packet snapshot."
        : "All checks passed. Ready for user-confirmed submission.",
    humanActionRequired: [],
  };
}

export function prioritizeApplications(
  applications: Array<{
    id: string;
    status: string;
    deadlineAt: string | null;
    completenessPercent: number;
  }>,
  now: Date = new Date(),
): Array<{ id: string; priority: number; urgency: DeadlineUrgency }> {
  return applications
    .filter((app) => !CLOSED_STATUSES.has(app.status))
    .map((app) => {
      const deadline = computeDeadlineInfo(app.deadlineAt, null, now);
      let priority = 0;
      priority += priorityFromUrgency(deadline.urgency, 0);
      if (app.completenessPercent < 100) priority += (100 - app.completenessPercent) / 5;
      return { id: app.id, priority, urgency: deadline.urgency };
    })
    .sort((a, b) => b.priority - a.priority);
}
