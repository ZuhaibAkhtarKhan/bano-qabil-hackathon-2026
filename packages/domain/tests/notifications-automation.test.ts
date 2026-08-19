import { describe, expect, it } from "vitest";

import {
  assessOperatingLoop,
  loopContinuity,
  notificationDraftFromEvent,
  notificationIdempotencyKey,
  planAutomation,
  type ApplicationAutomationSnapshot,
  type DomainEvent,
} from "../src/index";

const baseSnapshot: ApplicationAutomationSnapshot = {
  applicationId: "app-1",
  opportunityId: "opp-1",
  userId: "user-1",
  title: "ML intern",
  organization: "Lab",
  status: "in_progress",
  deadlineAt: "2026-08-20T00:00:00.000Z",
  deadlineTimezone: null,
  completenessPercent: 40,
  totalQuestions: 2,
  approvedAnswers: 0,
  pendingDocuments: 1,
  fitScore: 55,
  unresolvedReviewCount: 0,
  hasCaptcha: false,
  hasSignature: false,
  hasPayment: false,
  interviewStartsAt: null,
  gmailConnected: true,
  calendarConnected: false,
  followUps: [],
  lastReminderAt: null,
};

describe("notification drafts from domain events", () => {
  it("keeps category, action link, priority, and a stable daily idempotency key", () => {
    const event: DomainEvent = {
      name: "application.deadline",
      userId: "user-1",
      applicationId: "app-1",
      opportunityId: "opp-1",
      subjectId: "app-1:deadline_monitor",
      title: "Deadline approaching",
      body: "Due soon.",
    };
    const now = new Date("2026-08-19T12:00:00.000Z");
    const draft = notificationDraftFromEvent(event, now);
    expect(draft?.category).toBe("deadline_approaching");
    expect(draft?.actionUrl).toBe("/app/applications/app-1");
    expect(draft?.priority).toBe("high");
    expect(draft?.channels).toEqual(["in_app", "email"]);
    expect(draft?.idempotencyKey).toBe(
      notificationIdempotencyKey("user-1", "deadline_approaching", "app-1:deadline_monitor", "2026-08-19"),
    );
  });

  it("does not invent a notice for events without a category", () => {
    expect(
      notificationDraftFromEvent({
        name: "opportunity.saved",
        userId: "u",
        subjectId: "x",
      }),
    ).not.toBeNull();
  });
});

describe("automation plans", () => {
  it("notifies for deadlines and missing answers but never auto-generates", () => {
    const decisions = planAutomation(baseSnapshot, new Date("2026-08-19T12:00:00.000Z"));
    expect(decisions.every((item) => item.safe)).toBe(true);
    expect(decisions.find((item) => item.kind === "deadline_monitor")?.action).toBe("notify");
    expect(decisions.find((item) => item.kind === "missing_answer")?.action).toBe("notify");
    expect(decisions.find((item) => item.kind === "answer_generation")?.action).toBe("propose");
    expect(decisions.find((item) => item.kind === "email_monitoring")?.action).toBe("propose");
  });

  it("skips answer generation when answers are already approved", () => {
    const decisions = planAutomation(
      { ...baseSnapshot, approvedAnswers: 2, pendingDocuments: 0, deadlineAt: null, completenessPercent: 90 },
      new Date("2026-08-19T12:00:00.000Z"),
    );
    expect(decisions.find((item) => item.kind === "answer_generation")?.action).toBe("skip");
  });
});

describe("operating loop", () => {
  it("marks later stages incomplete until earlier data exists", () => {
    const loop = assessOperatingLoop({
      hasOpportunity: true,
      opportunityAnalyzed: true,
      hasEligibility: true,
      hasFit: false,
      hasResumeMatch: false,
      hasGeneratedAnswer: false,
      hasApprovedAnswer: false,
      hasAutofillMapping: false,
      hasSubmissionSnapshot: false,
      hasTrackingEvent: true,
      hasEmailEvent: false,
      hasCalendarEvent: false,
      hasVerifiedMemory: true,
      hasNextApplication: false,
    });
    expect(loop.find((stage) => stage.id === "analyze")?.done).toBe(true);
    expect(loop.find((stage) => stage.id === "fit")?.done).toBe(false);
    expect(loop.find((stage) => stage.id === "apply")?.done).toBe(false);
    expect(loopContinuity(loop).brokenAt).toBe("fit");
  });
});
