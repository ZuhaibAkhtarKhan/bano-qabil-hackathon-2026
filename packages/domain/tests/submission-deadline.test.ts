import { describe, expect, it } from "vitest";

import {
  computeDeadlineInfo,
  DEFAULT_AUTO_SUBMIT_POLICY,
  SILENCE_AUTO_SUBMIT_POLICY,
  evaluateAutoSubmit,
  evaluateSubmissionGuard,
  generateReminder,
  prioritizeApplications,
  type AutoSubmitPolicy,
  type ReminderInput,
  type SubmissionInput,
} from "@1apply/domain";

function makeGuardInput(overrides: Partial<SubmissionInput> = {}): SubmissionInput {
  return {
    applicationId: "app-1",
    status: "ready",
    questions: [{ id: "q1", prompt: "Why?" }],
    approvedAnswerIds: new Map([["q1", "v1"]]),
    attachedDocumentIds: ["doc-1"],
    resumeMatchRecommended: "doc-resume",
    eligibilityResults: [{ state: "met", explanation: "OK" }],
    reviewItems: [{ resolved: true, prompt: "Check" }],
    snapshots: [],
    fitScore: 85,
    fitMissing: [],
    hasSignatureField: false,
    hasPaymentField: false,
    hasCaptcha: false,
    hasSecurityChallenge: false,
    userAuthenticated: true,
    ...overrides,
  };
}

function makeReminderInput(overrides: Partial<ReminderInput> = {}): ReminderInput {
  return {
    applicationTitle: "Google SWE Internship",
    organization: "Google",
    deadlineAt: null,
    deadlineTimezone: null,
    completenessPercent: 80,
    totalQuestions: 3,
    answeredQuestions: 2,
    pendingDocuments: 0,
    fitScore: 85,
    status: "preparing",
    submittedAt: null,
    hasCaptcha: false,
    hasSignature: false,
    hasPayment: false,
    unresolvedReviewCount: 0,
    interviewDates: [],
    contacts: [],
    followUps: [],
    ...overrides,
  };
}

describe("submission guard", () => {
  it("passes when all checks are satisfied", () => {
    const guard = evaluateSubmissionGuard(makeGuardInput());
    expect(guard.safe).toBe(true);
    expect(guard.blockers).toHaveLength(0);
    expect(guard.checks.every((c) => c.passed || !c.blocking)).toBe(true);
  });

  it("blocks when user is not authenticated", () => {
    const guard = evaluateSubmissionGuard(makeGuardInput({ userAuthenticated: false }));
    expect(guard.safe).toBe(false);
    expect(guard.blockers.some((b) => b.kind === "user_authorization")).toBe(true);
  });

  it("blocks when required answers are missing", () => {
    const guard = evaluateSubmissionGuard(
      makeGuardInput({ approvedAnswerIds: new Map() }),
    );
    expect(guard.safe).toBe(false);
    expect(guard.blockers.some((b) => b.kind === "approved_answers")).toBe(true);
  });

  it("blocks when CAPTCHA is detected", () => {
    const guard = evaluateSubmissionGuard(makeGuardInput({ hasCaptcha: true }));
    expect(guard.safe).toBe(false);
    expect(guard.blockers.some((b) => b.kind === "captcha_status")).toBe(true);
    expect(guard.checks.find((c) => c.kind === "captcha_status")?.reason).toMatch(/CAPTCHA/);
  });

  it("blocks when signature is required", () => {
    const guard = evaluateSubmissionGuard(makeGuardInput({ hasSignatureField: true }));
    expect(guard.safe).toBe(false);
    expect(guard.blockers.some((b) => b.kind === "signature_status")).toBe(true);
  });

  it("blocks when payment is required", () => {
    const guard = evaluateSubmissionGuard(makeGuardInput({ hasPaymentField: true }));
    expect(guard.safe).toBe(false);
    expect(guard.blockers.some((b) => b.kind === "payment_status")).toBe(true);
  });

  it("warns but does not block for missing documents when no questions", () => {
    const guard = evaluateSubmissionGuard(
      makeGuardInput({
        questions: [],
        approvedAnswerIds: new Map(),
        attachedDocumentIds: [],
      }),
    );
    expect(guard.safe).toBe(true);
  });

  it("generates a stable idempotency key", () => {
    const input = makeGuardInput();
    const a = evaluateSubmissionGuard(input);
    const b = evaluateSubmissionGuard(input);
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.idempotencyKey.length).toBeGreaterThan(10);
  });

  it("generates different idempotency keys for different inputs", () => {
    const a = evaluateSubmissionGuard(makeGuardInput());
    const b = evaluateSubmissionGuard(
      makeGuardInput({ approvedAnswerIds: new Map([["q1", "v2"]]) }),
    );
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });

  it("warns on duplicate snapshots without blocking", () => {
    const guard = evaluateSubmissionGuard(
      makeGuardInput({ snapshots: [{ id: "snap-1" }] }),
    );
    expect(guard.safe).toBe(true);
    expect(guard.warnings.some((w) => w.kind === "duplicate_protection")).toBe(true);
  });
});

describe("deadline intelligence", () => {
  it("computes overdue urgency for past deadlines", () => {
    const info = computeDeadlineInfo(
      "2026-08-01T00:00:00Z",
      null,
      new Date("2026-08-19T12:00:00Z"),
    );
    expect(info.urgency).toBe("overdue");
    expect(info.hoursRemaining).toBeLessThan(0);
    expect(info.label).toMatch(/Overdue/);
  });

  it("computes imminent urgency when < 24 hours remain", () => {
    const deadline = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const info = computeDeadlineInfo(deadline, null);
    expect(info.urgency).toBe("imminent");
    expect(info.hoursRemaining).toBeGreaterThan(0);
    expect(info.hoursRemaining).toBeLessThan(24);
  });

  it("computes soon urgency when < 72 hours remain", () => {
    const deadline = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const info = computeDeadlineInfo(deadline, null);
    expect(info.urgency).toBe("soon");
  });

  it("handles timezones by passing them to DateTimeFormat", () => {
    const info = computeDeadlineInfo(
      "2026-09-01T23:59:00Z",
      "America/New_York",
      new Date("2026-08-31T12:00:00Z"),
    );
    expect(info.deadlineTimezone).toBe("America/New_York");
    expect(info.urgency).toBe("soon");
  });

  it("returns none for null deadline", () => {
    const info = computeDeadlineInfo(null, null);
    expect(info.urgency).toBe("none");
    expect(info.hoursRemaining).toBeNull();
  });
});

describe("reminders", () => {
  it("generates a deadline-approaching reminder for imminent deadlines", () => {
    const deadline = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    const reminder = generateReminder(
      makeReminderInput({
        deadlineAt: deadline,
        totalQuestions: 3,
        answeredQuestions: 3,
        pendingDocuments: 0,
        completenessPercent: 90,
        unresolvedReviewCount: 1,
      }),
    );
    expect(reminder).not.toBeNull();
    expect(reminder!.state).toBe("deadline_approaching");
    expect(reminder!.urgency).toBe("imminent");
    expect(reminder!.priority).toBeGreaterThan(80);
  });

  it("generates human_action_required when CAPTCHA exists", () => {
    const reminder = generateReminder(
      makeReminderInput({ hasCaptcha: true, deadlineAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() }),
    );
    expect(reminder!.state).toBe("human_action_required");
    expect(reminder!.body).toMatch(/CAPTCHA/);
  });

  it("generates answer_required when questions are unanswered near deadline", () => {
    const reminder = generateReminder(
      makeReminderInput({
        totalQuestions: 3,
        answeredQuestions: 1,
        deadlineAt: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
      }),
    );
    expect(reminder!.state).toBe("answer_required");
    expect(reminder!.body).toMatch(/2 questions/);
  });

  it("generates submission_ready when application is complete", () => {
    const reminder = generateReminder(
      makeReminderInput({
        totalQuestions: 3,
        answeredQuestions: 3,
        pendingDocuments: 0,
        completenessPercent: 100,
        unresolvedReviewCount: 0,
        deadlineAt: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
      }),
    );
    expect(reminder!.state).toBe("submission_ready");
    expect(reminder!.body).toMatch(/ready to submit|100% complete/);
  });

  it("returns null for closed statuses", () => {
    expect(generateReminder(makeReminderInput({ status: "submitted" }))).toBeNull();
    expect(generateReminder(makeReminderInput({ status: "rejected" }))).toBeNull();
    expect(generateReminder(makeReminderInput({ status: "archived" }))).toBeNull();
  });

  it("formats a realistic reminder message", () => {
    const reminder = generateReminder(
      makeReminderInput({
        applicationTitle: "Google SWE Internship",
        organization: "Google",
        completenessPercent: 80,
        totalQuestions: 5,
        answeredQuestions: 4,
        deadlineAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
      }),
    );
    expect(reminder!.body).toMatch(/80% complete/);
    expect(reminder!.title).toMatch(/Google/);
    expect(reminder!.state).toBe("answer_required");
  });
});

describe("deadline prioritization", () => {
  it("sorts incomplete applications near deadline first", () => {
    const result = prioritizeApplications([
      { id: "far", status: "preparing", deadlineAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), completenessPercent: 90 },
      { id: "near", status: "preparing", deadlineAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), completenessPercent: 40 },
      { id: "mid", status: "ready", deadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), completenessPercent: 70 },
    ]);
    expect(result[0]!.id).toBe("near");
    expect(result[0]!.urgency).toBe("imminent");
  });

  it("excludes closed applications", () => {
    const result = prioritizeApplications([
      { id: "closed", status: "submitted", deadlineAt: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(), completenessPercent: 100 },
      { id: "open", status: "preparing", deadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), completenessPercent: 50 },
    ]);
    expect(result.map((r) => r.id)).toEqual(["open"]);
  });
});

describe("auto-submit policy", () => {
  const enabledPolicy: AutoSubmitPolicy = {
    ...DEFAULT_AUTO_SUBMIT_POLICY,
    enabled: true,
    boundedToDeadlineHours: 24,
  };

  it("blocks when auto-submit is disabled", () => {
    const decision = evaluateAutoSubmit(
      DEFAULT_AUTO_SUBMIT_POLICY,
      {
        ...makeReminderInput({ deadlineAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString() }),
        allAnswersApproved: true,
        documentsAttached: true,
        hasUnsupportedClaims: false,
      },
    );
    expect(decision.action).toBe("block");
    expect(decision.reason).toMatch(/not enabled/);
  });

  it("pauses when CAPTCHA is detected", () => {
    const decision = evaluateAutoSubmit(
      enabledPolicy,
      {
        ...makeReminderInput({ hasCaptcha: true, deadlineAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString() }),
        allAnswersApproved: true,
        documentsAttached: true,
        hasUnsupportedClaims: false,
      },
    );
    expect(decision.action).toBe("pause");
    expect(decision.humanActionRequired).toContain("Complete CAPTCHA manually");
  });

  it("pauses when signature is required", () => {
    const decision = evaluateAutoSubmit(
      enabledPolicy,
      {
        ...makeReminderInput({ hasSignature: true, deadlineAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString() }),
        allAnswersApproved: true,
        documentsAttached: true,
        hasUnsupportedClaims: false,
      },
    );
    expect(decision.action).toBe("pause");
    expect(decision.humanActionRequired).toContain("Sign the document manually");
  });

  it("blocks when outside bounded deadline window", () => {
    const decision = evaluateAutoSubmit(
      enabledPolicy,
      {
        ...makeReminderInput({ deadlineAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() }),
        allAnswersApproved: true,
        documentsAttached: true,
        hasUnsupportedClaims: false,
      },
    );
    expect(decision.action).toBe("block");
    expect(decision.reason).toMatch(/outside.*window/);
  });

  it("proceeds when all conditions are met within deadline window", () => {
    const decision = evaluateAutoSubmit(
      enabledPolicy,
      {
        ...makeReminderInput({
          fitScore: 85,
          deadlineAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        }),
        allAnswersApproved: true,
        documentsAttached: true,
        hasUnsupportedClaims: false,
      },
    );
    expect(decision.action).toBe("proceed");
  });

  it("freezes a silence packet only at or after the deadline", () => {
    const beforeDeadline = evaluateAutoSubmit(
      SILENCE_AUTO_SUBMIT_POLICY,
      {
        ...makeReminderInput({
          deadlineAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
          identityPresent: true,
          packetNoticeSent: true,
          allQuestionsHavePacketText: true,
        }),
        allAnswersApproved: false,
        documentsAttached: true,
        hasUnsupportedClaims: false,
      },
    );
    expect(beforeDeadline.action).toBe("block");

    const atDeadline = evaluateAutoSubmit(
      SILENCE_AUTO_SUBMIT_POLICY,
      {
        ...makeReminderInput({
          deadlineAt: new Date(Date.now() - 60 * 1000).toISOString(),
          identityPresent: true,
          packetNoticeSent: true,
          allQuestionsHavePacketText: true,
        }),
        allAnswersApproved: false,
        documentsAttached: true,
        hasUnsupportedClaims: false,
      },
    );
    expect(atDeadline.action).toBe("proceed");
    expect(atDeadline.reason).toMatch(/Do not click host Submit/);
  });

  it("never bypasses CAPTCHA/signature/payment even when enabled", () => {
    expect(enabledPolicy.neverBypassCaptcha).toBe(true);
    expect(enabledPolicy.neverBypassSignature).toBe(true);
    expect(enabledPolicy.neverBypassPayment).toBe(true);
    expect(enabledPolicy.neverBypassAuth).toBe(true);
    expect(enabledPolicy.neverBypassLegalAttestation).toBe(true);
    expect(enabledPolicy.auditTrail).toBe(true);
  });
});
