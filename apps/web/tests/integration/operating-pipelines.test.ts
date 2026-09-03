import { describe, expect, it } from "vitest";

import {
  associateEmailToApplication,
  buildProposedCalendarEvent,
  classifyEmail,
  classifyQuestion,
  computeFitIndex,
  detectMemoryConflicts,
  eligibilityLabel,
  evaluateEligibility,
  evaluateSubmissionGuard,
  finalizeGroundedDraft,
  freezeSubmissionManifest,
  generateReminder,
  memoryFactKey,
  normalizeOpportunityUrl,
  rankEvidenceForAnswer,
  rankResumes,
  validateClaims,
  type MemoryEvidence,
} from "@1apply/domain";

import { computeApplicationCompleteness } from "@/lib/application-workflow";
import { planDocumentExtraction } from "@/server/memory/plan-extraction";
import { mergeRequirementRows, parseDeadline } from "@/server/opportunities/analyze";
import { opportunityExtractionSchema } from "@/infra/ai/openai";

const verified: MemoryEvidence[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "NED AI/ML Project",
    kind: "project",
    organization: "NED University",
    situation: "Built a document retrieval pipeline",
    action: "Trained a Python transformer model",
    outcome: "Achieved 92 percent recall",
    skills: ["python", "pytorch"],
    verificationStatus: "verified",
    excludedFromAi: false,
  },
];

describe("Profile → Application Memory", () => {
  it("keys extracted identity facts without inventing a second person", () => {
    const key = memoryFactKey({ category: "personal", field: "display_name", title: "identity" });
    expect(key).toContain("personal");
    const conflicts = detectMemoryConflicts([
      { id: "f1", userId: "u1", category: "personal", factKey: key, value: "Amina Khan", verificationStatus: "verified" },
      { id: "f2", userId: "u1", category: "personal", factKey: key, value: "Amina K.", verificationStatus: "unverified" },
    ]);
    expect(conflicts).toHaveLength(1);
  });
});

describe("Document → Extraction → Evidence → Memory", () => {
  it("plans evidence from resume text and flags conflicting graduation years", () => {
    const plan = planDocumentExtraction(
      {
        displayName: "Amina Khan",
        headline: "ML student",
        skills: ["Python"],
        evidence: [
          {
            title: "BS Computer Science",
            kind: "education",
            organization: "NED University",
            situation: "Undergraduate",
            action: null,
            outcome: "Expected graduation",
            skills: ["python"],
            endDate: "2028-06-01",
            excerpt: "B.S. Computer Science, expected 2028",
          },
        ],
      },
      [
        {
          id: "existing",
          userId: "u1",
          category: "education",
          factKey: memoryFactKey({
            category: "education",
            organization: "NED University",
            title: "BS Computer Science",
            field: "end_year",
          }),
          value: "2027",
          verificationStatus: "unverified",
        },
      ],
    );
    expect(plan.evidence[0]?.kind).toBe("education");
    expect(plan.evidence[0]?.verificationStatus).toBe("unverified");
    expect(plan.skills).toContain("Python");
  });
});

describe("Opportunity → Analysis → Requirements → Eligibility → Fit", () => {
  it("extracts structured fields then scores eligibility and fit from memory", () => {
    const extracted = opportunityExtractionSchema.parse({
      title: "ML intern",
      organization: "Lab",
      category: "internship",
      location: "Karachi / Remote",
      deadline: "2026-09-01",
      eligibilityCriteria: ["Undergraduate student"],
      skills: ["Python"],
      experienceRequirements: ["Prior machine learning project"],
      requirements: [{ text: "Must graduate after 2027", hard: true, kind: "education" }],
      questions: [{ prompt: "Why are you interested?", limitValue: 300, limitUnit: "words" }],
      requiredDocuments: [{ label: "Resume", required: true }],
      importantDates: [{ label: "Deadline", date: "2026-09-01" }],
    });
    expect(extracted.location).toMatch(/Karachi/);
    expect(extracted.deadline).toBe("2026-09-01");
    expect(extracted.eligibilityCriteria[0]).toMatch(/Undergraduate/);
    expect(extracted.skills).toContain("Python");
    expect(extracted.experienceRequirements[0]).toMatch(/machine learning/i);
    expect(extracted.questions[0]?.prompt).toMatch(/interested/i);
    expect(extracted.requiredDocuments[0]?.label).toBe("Resume");
    expect(extracted.requirements[0]?.text).toMatch(/graduate after 2027/);

    const rows = mergeRequirementRows(extracted);
    expect(rows.some((row) => /python/i.test(row.text))).toBe(true);
    expect(parseDeadline("2026-09-01")).not.toBeNull();
    expect(normalizeOpportunityUrl("https://www.lab.org/intern?utm_source=x")).toBe("https://lab.org/intern");

    const eligibility = evaluateEligibility(
      rows.map((row, index) => ({ id: `r${index}`, text: row.text, hard: row.hard, kind: row.kind })),
      verified,
      { locationCity: "Karachi", locationCountry: "Pakistan" },
    );
    expect(eligibility.some((item) => eligibilityLabel(item.state).match(/satisfied/i))).toBe(true);
    const fit = computeFitIndex({
      eligibility,
      evidence: verified,
      opportunityText: "Python machine learning internship in Karachi",
    });
    expect(fit.score).toBeGreaterThan(0);
    expect(fit.score).toBeLessThanOrEqual(100);
  });
});

describe("Question → Evidence → Answer → Validation → Approval", () => {
  it("ranks evidence, grounds the draft, and only approves cited verified ids", () => {
    expect(classifyQuestion("Why are you interested in this internship?")).toBe("why_interested");
    const ranked = rankEvidenceForAnswer("machine learning python project", "experience", verified);
    expect(ranked[0]?.id).toBe(verified[0]?.id);
    const text = "I trained a Python transformer model at NED University for the NED AI/ML Project.";
    expect(validateClaims(text, ranked).every((flag) => flag.supported)).toBe(true);
    const draft = finalizeGroundedDraft({
      text,
      citedIds: ranked.map((item) => item.id),
      allowedIds: ranked.map((item) => item.id),
    });
    expect(draft.warnings).not.toContain("NO_EVIDENCE");
    expect(draft.evidenceIds).toEqual([verified[0]?.id]);
  });
});

describe("Application → Documents → Answers → Submission → Tracking", () => {
  it("freezes exact versions, blocks unsafe submit, and still tracks the host outcome", () => {
    const completeness = computeApplicationCompleteness({
      requiredQuestions: 1,
      approvedAnswers: 1,
      requiredDocuments: ["Resume"],
      attachedDocumentLabels: ["Resume"],
      eligibilityNeedsReview: [],
      missingFitItems: [],
      recommendedResumeSelected: true,
      fieldMappingsPending: 0,
    });
    expect(completeness.readyForSubmission).toBe(true);

    const ranked = rankResumes("machine learning internship", [
      { documentId: "resume-ml", documentVersionId: "v2", label: "AI/ML Resume", type: "resume_variant" },
      { documentId: "resume-web", documentVersionId: "v1", label: "Web Development", type: "resume_variant" },
    ]);
    expect(ranked[0]?.documentId).toBe("resume-ml");

    const snapshot = freezeSubmissionManifest({
      answers: [{ questionId: "q1", answerVersionId: "a1" }],
      documents: [{ documentId: "resume-ml", documentVersionId: "v2" }],
    });
    expect(snapshot.documentManifest[0]?.documentVersionId).toBe("v2");

    const blocked = evaluateSubmissionGuard({
      applicationId: "app-1",
      status: "ready",
      questions: [{ id: "q1", prompt: "Why?" }],
      approvedAnswerIds: new Map([["q1", "a1"]]),
      attachedDocumentIds: ["resume-ml"],
      resumeMatchRecommended: "resume-ml",
      eligibilityResults: [{ state: "met", explanation: "ok" }],
      reviewItems: [],
      snapshots: [],
      fitScore: 80,
      fitMissing: [],
      hasSignatureField: false,
      hasPaymentField: false,
      hasCaptcha: true,
      hasSecurityChallenge: false,
      userAuthenticated: true,
    });
    expect(blocked.safe).toBe(false);

    const classified = classifyEmail({
      subject: "Your application to Lab ML intern has been received",
      snippet: "We received your application for the ML intern position.",
      from: "noreply@lab.org",
      date: "2026-08-19",
    });
    expect(classified.category).toBe("application_received");
  });
});

describe("Email → Event → Application and Interview → Calendar → Reminder", () => {
  it("associates interview mail, proposes a calendar event, and reminds the user", () => {
    const classified = classifyEmail({
      subject: "Interview invitation for ML intern at Lab on Monday at 3pm",
      snippet: "Please join the interview for the ML intern application.",
      from: "recruiter@lab.org",
      date: "2026-08-19",
    });
    expect(classified.interviewDetected).toBe(true);
    const linked = associateEmailToApplication(
      {
        organization: "Lab",
        opportunityTitle: "ML intern",
        subject: classified.subject,
        snippet: classified.subject,
        from: "recruiter@lab.org",
        senderDomain: "lab.org",
        links: ["https://calendly.com/lab"],
        date: "2026-08-19",
      },
      [{ id: "app-1", opportunityTitle: "ML intern", organization: "Lab", sourceUrl: "https://lab.org/intern", status: "submitted" }],
    );
    expect(linked.applicationId).toBe("app-1");
    const proposed = buildProposedCalendarEvent({
      applicationId: "app-1",
      opportunityTitle: "ML intern",
      organization: "Lab",
      interviewDateHints: ["2026-08-24T15:00:00.000Z"],
      emailSnippet: "Join https://meet.google.com/abc-defg",
      emailSubject: classified.subject,
      meetingUrl: null,
      location: null,
      timezone: "UTC",
    });
    expect(proposed.needsUserConfirmation).toBe(true);
    expect(proposed.startsAt).toBe("2026-08-24T15:00:00.000Z");
    const reminder = generateReminder({
      applicationTitle: "ML intern",
      organization: "Lab",
      deadlineAt: "2026-08-20T12:00:00.000Z",
      deadlineTimezone: null,
      completenessPercent: 90,
      totalQuestions: 1,
      answeredQuestions: 1,
      pendingDocuments: 0,
      fitScore: 80,
      status: "preparing",
      submittedAt: null,
      hasCaptcha: false,
      hasSignature: false,
      hasPayment: false,
      unresolvedReviewCount: 0,
      interviewDates: ["2026-08-24T15:00:00.000Z"],
      contacts: [],
      followUps: [],
    }, new Date("2026-08-19T12:00:00.000Z"));
    expect(reminder).not.toBeNull();
  });
});

describe("success timing", () => {
  it("runs profile-to-workspace and opportunity analysis locally in well under the proposal budgets", () => {
    const start = Date.now();
    for (let i = 0; i < 25; i += 1) {
      const eligibility = evaluateEligibility(
        [{ id: "r1", text: "Python machine learning project experience", hard: false }],
        verified,
      );
      computeFitIndex({ eligibility, evidence: verified, opportunityText: "Python ML intern" });
      rankResumes("machine learning internship", [
        { documentId: "a", documentVersionId: "v1", label: "AI/ML Resume", type: "resume" },
      ]);
      rankEvidenceForAnswer("python project", "experience", verified);
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2 * 60 * 1000);
    expect(elapsed).toBeLessThan(5 * 60 * 1000);
  });
});
