import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTO_SUBMIT_POLICY,
  associateEmailToApplication,
  buildAnswerPrompt,
  classifyEmail,
  computeFitIndex,
  eligibilityLabel,
  evaluateAutoSubmit,
  evaluateEligibility,
  evaluateSubmissionGuard,
  extractClaims,
  finalizeGroundedDraft,
  groundingScore,
  rankEvidenceForAnswer,
  rankResumes,
  validateClaims,
  type MemoryEvidence,
  type SubmissionInput,
} from "../src/index";

const evidence: MemoryEvidence[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "NED AI/ML Project",
    kind: "project",
    organization: "NED University",
    situation: "Built a document retrieval pipeline",
    action: "Trained a Python transformer model",
    outcome: "Achieved 92 percent recall on test set",
    skills: ["python", "pytorch", "transformers"],
    verificationStatus: "verified",
    excludedFromAi: false,
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    title: "Unverified CERN claim",
    kind: "employment",
    organization: "CERN",
    situation: null,
    action: null,
    outcome: null,
    skills: ["physics"],
    verificationStatus: "unverified",
    excludedFromAi: false,
  },
];

const verified = evidence.filter((item) => item.verificationStatus === "verified");

describe("AI eval: grounding ≥95%", () => {
  const groundedAnswers = [
    "I trained a Python transformer model at NED University for the NED AI/ML Project.",
    "I built a document retrieval pipeline using Python and transformers at NED University.",
    "The NED AI/ML Project achieved 92 percent recall on the test set after I trained a Python transformer model.",
  ];

  it("backs factual claims with verified evidence at or above 95%", () => {
    const scores = groundedAnswers.map((text) => groundingScore(validateClaims(text, verified)));
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    expect(mean).toBeGreaterThanOrEqual(0.95);
    expect(scores.every((score) => score >= 0.95)).toBe(true);
  });
});

describe("AI eval: hallucination resistance", () => {
  it("refuses to treat invented experience as grounded", () => {
    const invented = "I worked at OpenAI Research as a senior engineer for 3 years and published 5 Nature papers.";
    const flags = validateClaims(invented, verified);
    expect(groundingScore(flags)).toBeLessThan(0.5);
    expect(flags.some((flag) => !flag.supported)).toBe(true);

    const draft = finalizeGroundedDraft({
      text: invented,
      citedIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
      allowedIds: verified.map((item) => item.id),
    });
    expect(draft.text).toBe("");
    expect(draft.warnings).toContain("NO_EVIDENCE");
    expect(draft.evidenceIds).toEqual([]);
  });

  it("does not rank unverified evidence into answer prompts", () => {
    const ranked = rankEvidenceForAnswer("CERN physics internship", "experience", evidence);
    expect(ranked.map((item) => item.id)).not.toContain("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    const { untrustedData } = buildAnswerPrompt({
      question: "Describe your experience",
      kind: "experience",
      opportunityContext: "ML intern",
      evidenceItems: ranked,
      intent: "draft",
      tone: "formal",
    });
    expect(untrustedData).not.toContain("CERN");
  });
});

describe("AI eval: eligibility states", () => {
  it("distinguishes satisfied, not satisfied, and unknown", () => {
    const [satisfied] = evaluateEligibility(
      [{ id: "s", text: "Python machine learning project experience", hard: false }],
      verified,
    );
    const [unknown] = evaluateEligibility(
      [{ id: "u", text: "Six month full-time availability in Zurich", hard: true }],
      verified,
    );
    const [notSatisfied] = evaluateEligibility(
      [{ id: "n", text: "Must be located in Zurich onsite", hard: true }],
      verified,
      { locationCity: "Karachi", locationCountry: "Pakistan" },
    );

    expect(eligibilityLabel(satisfied?.state ?? "")).toMatch(/satisfied/i);
    expect(eligibilityLabel(unknown?.state ?? "")).toMatch(/unknown|needs confirmation|unclear/i);
    expect(eligibilityLabel(notSatisfied?.state ?? "")).toMatch(/not satisfied/i);
  });
});

describe("AI eval: resume matching ≥95%", () => {
  it("selects the relevant resume as the top recommendation", () => {
    const cases = [
      { query: "machine learning research pytorch", labels: ["AI/ML Resume", "Web Development CV", "General resume"], expected: "AI/ML Resume" },
      { query: "frontend react next.js internship", labels: ["Web Development CV", "AI/ML Resume", "Research statement"], expected: "Web Development CV" },
      { query: "software engineering backend systems", labels: ["Software Engineering", "Research statement", "General resume"], expected: "Software Engineering" },
      { query: "nlp research publication thesis", labels: ["Research statement", "Web Development CV", "General resume"], expected: "Research statement" },
      { query: "general internship application", labels: ["General resume", "Web Development CV"], expected: "General resume" },
    ];
    const correct = cases.filter((item) => {
      const ranked = rankResumes(
        item.query,
        item.labels.map((label, index) => ({
          documentId: `d${index}`,
          documentVersionId: `v${index}`,
          label,
          type: "resume_variant",
        })),
      );
      return ranked[0]?.label === item.expected;
    }).length;
    expect(correct / cases.length).toBeGreaterThanOrEqual(0.95);
  });
});

describe("AI eval: answer generation stays grounded", () => {
  it("keeps generated-style answers inside cited verified evidence", () => {
    const text = "I trained a Python transformer model at NED University and built a document retrieval pipeline.";
    const flags = validateClaims(text, verified);
    expect(groundingScore(flags)).toBeGreaterThanOrEqual(0.95);
    expect(extractClaims(text).length).toBeGreaterThan(0);
    const draft = finalizeGroundedDraft({
      text,
      citedIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      allowedIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
    });
    expect(draft.text).toContain("Python");
    expect(draft.evidenceIds).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
  });
});

describe("success metrics", () => {
  it("never auto-submits and never treats CAPTCHA as a safe fill", () => {
    expect(DEFAULT_AUTO_SUBMIT_POLICY.enabled).toBe(false);
    const auto = evaluateAutoSubmit(DEFAULT_AUTO_SUBMIT_POLICY, {
      applicationTitle: "ML intern",
      organization: "Lab",
      deadlineAt: null,
      deadlineTimezone: null,
      completenessPercent: 100,
      totalQuestions: 1,
      answeredQuestions: 1,
      pendingDocuments: 0,
      fitScore: 90,
      status: "ready",
      submittedAt: null,
      hasCaptcha: true,
      hasSignature: false,
      hasPayment: false,
      unresolvedReviewCount: 0,
      interviewDates: [],
      contacts: [],
      followUps: [],
      allAnswersApproved: true,
      documentsAttached: true,
      hasUnsupportedClaims: false,
    });
    expect(auto.action).toBe("block");

    const guard = evaluateSubmissionGuard({
      applicationId: "app-1",
      status: "ready",
      questions: [{ id: "q1", prompt: "Why?" }],
      approvedAnswerIds: new Map([["q1", "v1"]]),
      attachedDocumentIds: ["doc-1"],
      resumeMatchRecommended: "doc-1",
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
    } satisfies SubmissionInput);
    expect(guard.safe).toBe(false);
    expect(guard.blockers.some((item) => item.kind === "captcha_status")).toBe(true);
  });

  it("tracks at least 90% of post-submission interview emails back to an application", () => {
    const application = {
      id: "app-1",
      opportunityTitle: "ML intern",
      organization: "Lab",
      sourceUrl: "https://lab.org/intern",
      status: "submitted",
    };
    const emails = [
      "Interview invitation for ML intern at Lab",
      "Lab recruiter: interview for the ML intern role",
      "Next steps for your ML intern application at Lab",
      "Lab interview schedule for ML intern",
      "Thanks for applying to Lab ML intern — interview details",
      "Lab.org interview confirmation for ML intern",
      "Unrelated newsletter from another company",
      "Lab ML intern interview reminder",
      "Please join the Lab interview for ML intern",
      "Lab recruiting: ML intern interview on Monday",
    ];
    const tracked = emails.filter((subject) => {
      const classified = classifyEmail({ subject, snippet: subject, from: "recruiter@lab.org", date: "2026-08-19" });
      const linked = associateEmailToApplication(
        {
          organization: "Lab",
          opportunityTitle: "ML intern",
          subject,
          snippet: subject,
          from: "recruiter@lab.org",
          senderDomain: "lab.org",
          links: ["https://lab.org/intern"],
          date: "2026-08-19",
        },
        [application],
      );
      return classified.category !== "irrelevant" && linked.applicationId === "app-1";
    }).length;
    expect(tracked / emails.length).toBeGreaterThanOrEqual(0.9);
  });

  it("computes Fit Index from eligibility without guessing unknown requirements", () => {
    const eligibility = evaluateEligibility(
      [
        { id: "r1", text: "Python machine learning project experience", hard: false },
        { id: "r2", text: "Must be available full-time", hard: true },
      ],
      verified,
    );
    const fit = computeFitIndex({
      eligibility,
      evidence: verified,
      opportunityText: "Python machine learning internship",
    });
    expect(fit.score).toBeLessThan(100);
    expect(fit.missing.length).toBeGreaterThan(0);
  });
});
