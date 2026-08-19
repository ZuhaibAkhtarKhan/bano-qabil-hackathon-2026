import { describe, expect, it } from "vitest";

import {
  associateEmailToApplication,
  classifyEmail,
  computeDeadlineInfo,
  computeFitIndex,
  deduplicateDiscoveries,
  eligibilityLabel,
  evaluateEligibility,
  generateReminder,
  notificationDraftFromEvent,
  normalizeOpportunityUrl,
  rankEvidenceForAnswer,
  rankEvidenceForQuestion,
  rankResumes,
  selectEvidenceForRequirement,
  type DomainEvent,
  type MemoryEvidence,
} from "../src/index";

const mlEvidence: MemoryEvidence = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Undergraduate machine learning project",
  kind: "project",
  organization: "NED University",
  situation: "Built a retrieval pipeline",
  action: "Trained a classifier in Python",
  outcome: "Shipped a working demo",
  skills: ["python", "pytorch", "machine", "learning"],
  verificationStatus: "verified",
  excludedFromAi: false,
};

const webEvidence: MemoryEvidence = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Campus web club",
  kind: "leadership",
  organization: "NED",
  situation: "Organized a hackathon",
  action: "Coordinated volunteers",
  outcome: "200 attendees",
  skills: ["leadership", "react"],
  verificationStatus: "verified",
  excludedFromAi: false,
};

describe("URL normalization", () => {
  it("strips www, trailing slashes, hashes, and tracking params", () => {
    expect(normalizeOpportunityUrl("HTTPS://WWW.Example.COM/jobs/ml/?utm_source=x&ref=1#top")).toBe(
      "https://example.com/jobs/ml",
    );
  });
});

describe("duplicate detection", () => {
  it("collapses the same posting reached via tracking links", () => {
    const items = deduplicateDiscoveries([
      {
        provider: "a",
        sourceUrl: "https://www.lab.org/intern?utm_campaign=x",
        canonicalUrl: "",
        title: "ML intern",
        organization: "Lab",
        category: "internship",
        location: "Remote",
        remote: true,
        educationLevel: "undergraduate",
        experienceLevel: "internship",
        domain: ["ai_ml"],
        skills: ["python"],
        excerpt: "Python",
        deadlineAt: null,
        quality: 0.8,
        requirements: [],
        alreadySaved: false,
      },
      {
        provider: "b",
        sourceUrl: "https://lab.org/intern/",
        canonicalUrl: "",
        title: "ML intern",
        organization: "Lab",
        category: "internship",
        location: "Remote",
        remote: true,
        educationLevel: "undergraduate",
        experienceLevel: "internship",
        domain: ["ai_ml"],
        skills: ["python"],
        excerpt: "Python",
        deadlineAt: null,
        quality: 0.9,
        requirements: [],
        alreadySaved: true,
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.alreadySaved).toBe(true);
    expect(items[0]?.canonicalUrl).toBe("https://lab.org/intern");
  });
});

describe("deadline calculations", () => {
  it("classifies imminent, overdue, and missing deadlines without inventing a date", () => {
    const now = new Date("2026-08-19T12:00:00.000Z");
    const imminent = computeDeadlineInfo("2026-08-19T20:00:00.000Z", null, now);
    const overdue = computeDeadlineInfo("2026-08-18T12:00:00.000Z", null, now);
    const missing = computeDeadlineInfo(null, null, now);
    expect(imminent.urgency).toBe("imminent");
    expect(overdue.urgency).toBe("overdue");
    expect(missing.deadlineAt).toBeNull();
    expect(missing.hoursRemaining).toBeNull();
    expect(generateReminder({
      applicationTitle: "ML intern",
      organization: "Lab",
      deadlineAt: "2026-08-19T20:00:00.000Z",
      deadlineTimezone: null,
      completenessPercent: 40,
      totalQuestions: 2,
      answeredQuestions: 0,
      pendingDocuments: 1,
      fitScore: 50,
      status: "preparing",
      submittedAt: null,
      hasCaptcha: false,
      hasSignature: false,
      hasPayment: false,
      unresolvedReviewCount: 0,
      interviewDates: [],
      contacts: [],
      followUps: [],
    }, now)?.state).toBeTruthy();
  });
});

describe("evidence selection", () => {
  it("selects the ML project for ML questions and ignores leadership for that query", () => {
    const selected = selectEvidenceForRequirement("python machine learning classifier", [mlEvidence, webEvidence]);
    expect(selected?.id).toBe(mlEvidence.id);
    const ranked = rankEvidenceForQuestion("Describe a machine learning project", [mlEvidence, webEvidence]);
    expect(ranked[0]?.id).toBe(mlEvidence.id);
    const forAnswer = rankEvidenceForAnswer("python machine learning internship", "experience", [mlEvidence, webEvidence]);
    expect(forAnswer[0]?.id).toBe(mlEvidence.id);
  });
});

describe("Fit Index calculation", () => {
  it("is a weighted, reconstructable score that does not treat unknown as met", () => {
    const eligibility = evaluateEligibility(
      [
        { id: "r1", text: "Python machine learning project experience", hard: false },
        { id: "r2", text: "Must be available full-time in Zurich", hard: true },
      ],
      [mlEvidence],
    );
    const fit = computeFitIndex({
      eligibility,
      evidence: [mlEvidence],
      opportunityText: "Python machine learning internship",
    });
    expect(fit.score).toBeGreaterThanOrEqual(0);
    expect(fit.score).toBeLessThanOrEqual(100);
    expect(fit.factors.reduce((sum, factor) => sum + factor.contribution, 0)).toBeCloseTo(fit.score, 0);
    expect(fit.missing.length).toBeGreaterThan(0);
  });
});

describe("resume ranking", () => {
  it("ranks the AI/ML resume first for an ML posting", () => {
    const ranked = rankResumes("machine learning research internship pytorch", [
      { documentId: "web", documentVersionId: "v1", label: "Web Development", type: "resume_variant" },
      { documentId: "ml", documentVersionId: "v2", label: "AI/ML Resume", type: "resume_variant" },
    ]);
    expect(ranked[0]?.documentId).toBe("ml");
    expect(ranked[0]?.recommended).toBe(true);
  });
});

describe("notification priority", () => {
  it("ranks CAPTCHA and failed submission above ordinary status changes", () => {
    const now = new Date("2026-08-19T12:00:00.000Z");
    const captcha = notificationDraftFromEvent(
      { name: "automation.account_action", userId: "u", subjectId: "s", payload: { captcha: true } } satisfies DomainEvent,
      now,
    );
    const deadline = notificationDraftFromEvent(
      { name: "application.deadline", userId: "u", applicationId: "a", subjectId: "d" },
      now,
    );
    const status = notificationDraftFromEvent(
      { name: "application.status_changed", userId: "u", applicationId: "a", subjectId: "st" },
      now,
    );
    expect(captcha?.numericPriority).toBeGreaterThan(deadline?.numericPriority ?? 0);
    expect(deadline?.numericPriority).toBeGreaterThan(status?.numericPriority ?? 0);
    expect(eligibilityLabel("met")).toMatch(/satisfied/i);
  });
});

describe("email to application association", () => {
  it("links an interview email to the matching workspace row", () => {
    const classified = classifyEmail({
      subject: "Interview invitation for ML intern — Lab",
      snippet: "We would like to interview you for the ML intern application.",
      from: "recruiter@lab.org",
      date: "2026-08-19",
    });
    expect(classified.interviewDetected).toBe(true);
    const linked = associateEmailToApplication(
      {
        organization: "Lab",
        opportunityTitle: "ML intern",
        subject: classified.subject,
        snippet: "Interview for ML intern at Lab",
        from: "recruiter@lab.org",
        senderDomain: "lab.org",
        links: ["https://lab.org/intern"],
        date: "2026-08-19",
      },
      [{ id: "app-1", opportunityTitle: "ML intern", organization: "Lab", sourceUrl: "https://lab.org/intern", status: "submitted" }],
    );
    expect(linked.applicationId).toBe("app-1");
    expect(linked.confidence).toBeGreaterThan(0.3);
  });
});
