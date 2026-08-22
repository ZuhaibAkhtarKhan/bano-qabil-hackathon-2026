import { computeDeadlineInfo, generateReminder, type ReminderInput } from "./deadline-intelligence";
import {
  reminderStateToEventName,
  type DomainEvent,
  type NotificationCategory,
} from "./notifications";

export const AUTOMATION_KINDS = [
  "deadline_monitor",
  "missing_answer",
  "answer_generation",
  "application_readiness",
  "email_monitoring",
  "interview_detection",
  "calendar_events",
  "follow_ups",
] as const;

export type AutomationKind = (typeof AUTOMATION_KINDS)[number];

export type AutomationAction = "notify" | "propose" | "skip";

export type ApplicationAutomationSnapshot = {
  applicationId: string;
  opportunityId: string | null;
  userId: string;
  title: string;
  organization: string | null;
  status: string;
  deadlineAt: string | null;
  deadlineTimezone: string | null;
  completenessPercent: number;
  totalQuestions: number;
  approvedAnswers: number;
  pendingDocuments: number;
  fitScore: number | null;
  unresolvedReviewCount: number;
  hasCaptcha: boolean;
  hasSignature: boolean;
  hasPayment: boolean;
  interviewStartsAt: string | null;
  gmailConnected: boolean;
  calendarConnected: boolean;
  followUps: string[];
  lastReminderAt: string | null;
};

export type AutomationDecision = {
  kind: AutomationKind;
  action: AutomationAction;
  safe: true;
  reason: string;
  event: DomainEvent | null;
};

function subject(snapshot: ApplicationAutomationSnapshot, kind: AutomationKind): string {
  return `${snapshot.applicationId}:${kind}`;
}

export function planAutomation(
  snapshot: ApplicationAutomationSnapshot,
  now: Date = new Date(),
): AutomationDecision[] {
  const decisions: AutomationDecision[] = [];
  const reminderInput: ReminderInput = {
    applicationTitle: snapshot.title,
    organization: snapshot.organization,
    deadlineAt: snapshot.deadlineAt,
    deadlineTimezone: snapshot.deadlineTimezone,
    completenessPercent: snapshot.completenessPercent,
    totalQuestions: snapshot.totalQuestions,
    answeredQuestions: snapshot.approvedAnswers,
    pendingDocuments: snapshot.pendingDocuments,
    fitScore: snapshot.fitScore,
    status: snapshot.status,
    submittedAt: null,
    hasCaptcha: snapshot.hasCaptcha,
    hasSignature: snapshot.hasSignature,
    hasPayment: snapshot.hasPayment,
    unresolvedReviewCount: snapshot.unresolvedReviewCount,
    interviewDates: snapshot.interviewStartsAt ? [snapshot.interviewStartsAt] : [],
    contacts: [],
    followUps: snapshot.followUps,
  };
  const reminder = generateReminder(reminderInput, now);
  const deadline = computeDeadlineInfo(snapshot.deadlineAt, snapshot.deadlineTimezone, now);

  if (reminder && (reminder.state === "deadline_approaching" || deadline.urgency === "imminent" || deadline.urgency === "soon" || deadline.urgency === "overdue")) {
    decisions.push({
      kind: "deadline_monitor",
      action: "notify",
      safe: true,
      reason: reminder.body,
      event: {
        name: "application.deadline",
        userId: snapshot.userId,
        applicationId: snapshot.applicationId,
        opportunityId: snapshot.opportunityId,
        subjectId: subject(snapshot, "deadline_monitor"),
        title: reminder.title,
        body: reminder.body,
      },
    });
  } else {
    decisions.push({
      kind: "deadline_monitor",
      action: "skip",
      safe: true,
      reason: "No approaching deadline that needs a notice.",
      event: null,
    });
  }

  const missingAnswers = Math.max(0, snapshot.totalQuestions - snapshot.approvedAnswers);
  if (missingAnswers > 0 && !["submitted", "rejected", "withdrawn", "archived"].includes(snapshot.status)) {
    decisions.push({
      kind: "missing_answer",
      action: "notify",
      safe: true,
      reason: `${missingAnswers} question(s) still need an approved answer.`,
      event: {
        name: reminderStateToEventName("answer_required"),
        userId: snapshot.userId,
        applicationId: snapshot.applicationId,
        opportunityId: snapshot.opportunityId,
        subjectId: subject(snapshot, "missing_answer"),
        title: `${snapshot.title}: ${missingAnswers} answer${missingAnswers === 1 ? "" : "s"} remaining`,
        body: "Open the application workspace to generate or approve answers. Automation never invents experience.",
      },
    });
    decisions.push({
      kind: "answer_generation",
      action: "propose",
      safe: true,
      reason: "Answer generation is prepared but not auto-run. The user must start it from the workspace.",
      event: null,
    });
  } else {
    decisions.push({
      kind: "missing_answer",
      action: "skip",
      safe: true,
      reason: "No missing answers to flag.",
      event: null,
    });
    decisions.push({
      kind: "answer_generation",
      action: "skip",
      safe: true,
      reason: "Nothing to generate, or the user has already approved answers.",
      event: null,
    });
  }

  if (snapshot.pendingDocuments > 0) {
    decisions.push({
      kind: "application_readiness",
      action: "notify",
      safe: true,
      reason: "Required documents are still missing.",
      event: {
        name: "document.missing",
        userId: snapshot.userId,
        applicationId: snapshot.applicationId,
        opportunityId: snapshot.opportunityId,
        subjectId: subject(snapshot, "application_readiness"),
        title: `${snapshot.title}: missing documents`,
        body: `Attach ${snapshot.pendingDocuments} required document${snapshot.pendingDocuments === 1 ? "" : "s"} before you freeze a snapshot.`,
      },
    });
  } else if (reminder?.state === "submission_ready") {
    decisions.push({
      kind: "application_readiness",
      action: "notify",
      safe: true,
      reason: reminder.body,
      event: {
        name: reminderStateToEventName("submission_ready"),
        userId: snapshot.userId,
        applicationId: snapshot.applicationId,
        opportunityId: snapshot.opportunityId,
        subjectId: subject(snapshot, "application_readiness"),
        title: reminder.title,
        body: reminder.body,
        payload: { ready: true },
      },
    });
  } else {
    decisions.push({
      kind: "application_readiness",
      action: "skip",
      safe: true,
      reason: "Application is not newly ready and documents are not blocking.",
      event: null,
    });
  }

  decisions.push({
    kind: "email_monitoring",
    action: snapshot.gmailConnected ? "propose" : "skip",
    safe: true,
    reason: snapshot.gmailConnected
      ? "Gmail is connected. Sync stays user-triggered and read-only."
      : "Gmail is not connected.",
    event: null,
  });

  if (snapshot.interviewStartsAt) {
    const start = new Date(snapshot.interviewStartsAt);
    const hours = (start.getTime() - now.getTime()) / 36e5;
    if (hours >= 0 && hours <= 48) {
      decisions.push({
        kind: "interview_detection",
        action: "notify",
        safe: true,
        reason: "An interview time is on file.",
        event: {
          name: "calendar.confirmed",
          userId: snapshot.userId,
          applicationId: snapshot.applicationId,
          opportunityId: snapshot.opportunityId,
          subjectId: subject(snapshot, "interview_detection"),
          title: `${snapshot.title}: interview reminder`,
          body: `Interview is on the calendar. Confirm details in Integrations. 1-Apply will not join the call for you.`,
        },
      });
      decisions.push({
        kind: "calendar_events",
        action: "propose",
        safe: true,
        reason: "Calendar write stays confirmation-gated.",
        event: null,
      });
    } else {
      decisions.push({
        kind: "interview_detection",
        action: "skip",
        safe: true,
        reason: "Interview is not inside the 48-hour reminder window.",
        event: null,
      });
      decisions.push({
        kind: "calendar_events",
        action: "skip",
        safe: true,
        reason: "No calendar reminder is due.",
        event: null,
      });
    }
  } else {
    decisions.push({
      kind: "interview_detection",
      action: "skip",
      safe: true,
      reason: "No interview time on file.",
      event: null,
    });
    decisions.push({
      kind: "calendar_events",
      action: snapshot.calendarConnected ? "propose" : "skip",
      safe: true,
      reason: snapshot.calendarConnected
        ? "Calendar is connected. Events still require confirmation."
        : "Google Calendar is not connected.",
      event: null,
    });
  }

  if (snapshot.followUps.length > 0) {
    decisions.push({
      kind: "follow_ups",
      action: "notify",
      safe: true,
      reason: "Follow-up items are waiting.",
      event: {
        name: "email.follow_up",
        userId: snapshot.userId,
        applicationId: snapshot.applicationId,
        opportunityId: snapshot.opportunityId,
        subjectId: subject(snapshot, "follow_ups"),
        title: `${snapshot.title}: follow-up`,
        body: snapshot.followUps.slice(0, 3).join(" "),
      },
    });
  } else {
    decisions.push({
      kind: "follow_ups",
      action: "skip",
      safe: true,
      reason: "No follow-up items recorded.",
      event: null,
    });
  }

  return decisions;
}

export function isUnsafeAutomation(kind: AutomationKind, action: AutomationAction): boolean {
  return kind === "answer_generation" && action !== "propose" && action !== "skip";
}

export type { NotificationCategory };
