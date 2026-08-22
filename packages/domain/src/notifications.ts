export const NOTIFICATION_CATEGORIES = [
  "deadline_approaching",
  "application_incomplete",
  "missing_information",
  "missing_document",
  "answer_ready",
  "answer_needs_review",
  "captcha_required",
  "account_action_required",
  "submission_completed",
  "submission_failed",
  "interview_detected",
  "interview_reminder",
  "application_status_changed",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const DOMAIN_EVENT_NAMES = [
  "opportunity.saved",
  "opportunity.analyzed",
  "intelligence.updated",
  "answer.generated",
  "answer.needs_review",
  "answer.approved",
  "application.status_changed",
  "application.incomplete",
  "application.deadline",
  "document.missing",
  "submission.completed",
  "submission.failed",
  "email.interview_detected",
  "email.follow_up",
  "calendar.proposed",
  "calendar.confirmed",
  "automation.account_action",
  "integration.connected",
  "integration.disconnected",
  "email.synced",
] as const;

export type DomainEventName = (typeof DOMAIN_EVENT_NAMES)[number];

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export type DomainEvent = {
  name: DomainEventName;
  userId: string;
  applicationId?: string | null;
  opportunityId?: string | null;
  subjectId: string;
  title?: string;
  body?: string;
  occurredAt?: string;
  payload?: Record<string, unknown>;
};

export type NotificationDraft = {
  category: NotificationCategory;
  title: string;
  body: string;
  priority: NotificationPriority;
  numericPriority: number;
  applicationId: string | null;
  opportunityId: string | null;
  actionUrl: string;
  eventName: DomainEventName;
  idempotencyKey: string;
  channels: Array<"in_app" | "email">;
};

const EVENT_TO_CATEGORY: Partial<Record<DomainEventName, NotificationCategory>> = {
  "application.deadline": "deadline_approaching",
  "application.incomplete": "application_incomplete",
  "document.missing": "missing_document",
  "answer.generated": "answer_ready",
  "answer.needs_review": "answer_needs_review",
  "answer.approved": "answer_ready",
  "submission.completed": "submission_completed",
  "submission.failed": "submission_failed",
  "email.interview_detected": "interview_detected",
  "calendar.proposed": "interview_detected",
  "calendar.confirmed": "interview_reminder",
  "application.status_changed": "application_status_changed",
  "automation.account_action": "account_action_required",
  "integration.connected": "account_action_required",
  "integration.disconnected": "account_action_required",
  "email.synced": "application_status_changed",
};

export function notificationIdempotencyKey(
  userId: string,
  category: NotificationCategory,
  subjectId: string,
  dayBucket: string,
): string {
  return `${userId}:${category}:${subjectId}:${dayBucket}`;
}

export function dayBucket(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function actionUrlFor(event: DomainEvent): string {
  if (event.applicationId) return `/app/applications/${event.applicationId}`;
  if (event.opportunityId) return `/app/opportunities/${event.opportunityId}`;
  if (event.name.startsWith("integration") || event.name.startsWith("email") || event.name.startsWith("calendar")) {
    return "/app/integrations";
  }
  return "/app/notifications";
}

function priorityFor(category: NotificationCategory): { label: NotificationPriority; numeric: number } {
  switch (category) {
    case "captcha_required":
    case "submission_failed":
      return { label: "urgent", numeric: 100 };
    case "deadline_approaching":
    case "interview_detected":
    case "interview_reminder":
      return { label: "high", numeric: 80 };
    case "answer_needs_review":
    case "missing_document":
    case "missing_information":
    case "account_action_required":
      return { label: "high", numeric: 70 };
    case "application_incomplete":
    case "application_status_changed":
      return { label: "normal", numeric: 50 };
    default:
      return { label: "normal", numeric: 40 };
  }
}

function defaultCopy(event: DomainEvent, category: NotificationCategory): { title: string; body: string } {
  const fallbackTitle = event.title ?? category.replace(/_/g, " ");
  const fallbackBody = event.body ?? "Open the related workspace to continue. Nothing was sent to a host.";
  return { title: fallbackTitle, body: fallbackBody };
}

export function notificationDraftFromEvent(event: DomainEvent, now: Date = new Date()): NotificationDraft | null {
  let category = EVENT_TO_CATEGORY[event.name];
  if (event.name === "intelligence.updated") {
    category = event.payload?.needsReview ? "missing_information" : "application_status_changed";
  }
  if (event.name === "opportunity.analyzed" || event.name === "opportunity.saved") {
    category = "application_status_changed";
  }
  if (event.name === "email.follow_up") category = "missing_information";
  if (event.payload?.captcha) category = "captcha_required";
  if (!category) return null;

  const { title, body } = defaultCopy(event, category);
  const priority = priorityFor(category);
  return {
    category,
    title,
    body,
    priority: priority.label,
    numericPriority: priority.numeric,
    applicationId: event.applicationId ?? null,
    opportunityId: event.opportunityId ?? null,
    actionUrl: actionUrlFor(event),
    eventName: event.name,
    idempotencyKey: notificationIdempotencyKey(event.userId, category, event.subjectId, dayBucket(now)),
    channels: ["in_app", "email"],
  };
}

export function reminderStateToEventName(
  state: string,
): DomainEventName {
  switch (state) {
    case "deadline_approaching":
      return "application.deadline";
    case "incomplete":
      return "application.incomplete";
    case "answer_required":
      return "answer.needs_review";
    case "document_required":
      return "document.missing";
    case "human_action_required":
      return "automation.account_action";
    case "submission_ready":
      return "application.status_changed";
    default:
      return "application.incomplete";
  }
}
