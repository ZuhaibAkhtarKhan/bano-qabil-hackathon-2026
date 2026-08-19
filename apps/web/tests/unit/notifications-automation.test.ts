import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { notificationCategorySchema, notificationChannelSchema } from "@1apply/contracts";
import { notificationDraftFromEvent, planAutomation } from "@1apply/domain";

const migration = readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20260819150000_notifications_automation.sql"),
  "utf8",
);

describe("phase 15 notification contracts", () => {
  it("covers the required notice categories and both channels", () => {
    expect(notificationCategorySchema.options).toEqual(
      expect.arrayContaining([
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
      ]),
    );
    expect(notificationChannelSchema.options).toEqual(["in_app", "email"]);
  });
});

describe("phase 15 migration", () => {
  it("adds action links, idempotency, deliveries, and automation runs", () => {
    expect(migration).toContain("action_url");
    expect(migration).toContain("idempotency_key");
    expect(migration).toContain("opportunity_id");
    expect(migration).toContain("notification_deliveries");
    expect(migration).toContain("automation_runs");
    expect(migration).toContain("user_id = auth.uid()");
  });
});

describe("phase 15 event mapping", () => {
  it("routes submission failure and interview events to the matching categories", () => {
    expect(
      notificationDraftFromEvent({
        name: "submission.failed",
        userId: "u",
        applicationId: "a",
        subjectId: "a",
      })?.category,
    ).toBe("submission_failed");
    expect(
      notificationDraftFromEvent({
        name: "email.interview_detected",
        userId: "u",
        applicationId: "a",
        subjectId: "e1",
      })?.category,
    ).toBe("interview_detected");
  });

  it("keeps answer generation as a proposal, not an unattended write", () => {
    const decisions = planAutomation({
      applicationId: "a",
      opportunityId: "o",
      userId: "u",
      title: "Role",
      organization: null,
      status: "in_progress",
      deadlineAt: null,
      deadlineTimezone: null,
      completenessPercent: 20,
      totalQuestions: 1,
      approvedAnswers: 0,
      pendingDocuments: 0,
      fitScore: null,
      unresolvedReviewCount: 0,
      hasCaptcha: false,
      hasSignature: false,
      hasPayment: false,
      interviewStartsAt: null,
      gmailConnected: false,
      calendarConnected: false,
      followUps: [],
      lastReminderAt: null,
    });
    expect(decisions.find((item) => item.kind === "answer_generation")?.action).toBe("propose");
  });
});
