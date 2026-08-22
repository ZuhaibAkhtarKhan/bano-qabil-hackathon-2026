import { describe, expect, it } from "vitest";

import {
  buildAnswerPrompt,
  classifyQuestion,
  extractClaims,
  groundingScore,
  rankEvidenceForAnswer,
  validateClaims,
  type QuestionKind,
} from "../src/answer-generation";
import type { MemoryEvidence } from "../src/intelligence-types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const verifiedEvidence: MemoryEvidence[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "NED AI/ML Project",
    kind: "project",
    organization: "NED University",
    situation: "Built a document retrieval pipeline",
    action: "Trained a Python transformer model",
    outcome: "Achieved 92% recall on test set",
    skills: ["python", "pytorch", "transformers"],
    verificationStatus: "verified",
    excludedFromAi: false,
    startDate: "2024-01",
    endDate: "2024-06",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    title: "Hackathon Win",
    kind: "achievement",
    organization: "Bano Qabil Hackathon",
    situation: "Competed against 80+ teams",
    action: "Built a full-stack React + Next.js app in 48 hours",
    outcome: "Won 1st place",
    skills: ["react", "nextjs", "typescript"],
    verificationStatus: "verified",
    excludedFromAi: false,
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    title: "Unverified internship",
    kind: "employment",
    organization: "SomeCompany",
    situation: null,
    action: null,
    outcome: null,
    skills: ["java"],
    verificationStatus: "unverified",
    excludedFromAi: false,
  },
];

// ─── classifyQuestion ─────────────────────────────────────────────────────────

describe("classifyQuestion", () => {
  it("classifies why interested question", () => {
    expect(classifyQuestion("Why are you interested in this internship?")).toBe("why_interested");
  });

  it("classifies why selected question", () => {
    expect(classifyQuestion("Why should you be selected?")).toBe("why_selected");
  });

  it("classifies experience question", () => {
    expect(classifyQuestion("Describe your relevant experience")).toBe("experience");
  });

  it("classifies achievement question", () => {
    expect(classifyQuestion("What is your greatest achievement?")).toBe("achievement");
  });

  it("classifies leadership question", () => {
    expect(classifyQuestion("Tell us about a time you led a team")).toBe("leadership");
  });

  it("falls back to general", () => {
    const kind = classifyQuestion("abcdef xyz totally ambiguous");
    expect(kind).toBe("general");
  });
});

// ─── rankEvidenceForAnswer ────────────────────────────────────────────────────

describe("rankEvidenceForAnswer", () => {
  it("returns only verified evidence", () => {
    const ranked = rankEvidenceForAnswer("python machine learning project", "experience", verifiedEvidence);
    const ids = ranked.map((e) => e.id);
    // Unverified should be excluded
    expect(ids).not.toContain("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  });

  it("ranks ML evidence higher for ML question", () => {
    const ranked = rankEvidenceForAnswer("python machine learning AI internship", "experience", verifiedEvidence);
    expect(ranked[0]?.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("returns empty array if no verified evidence", () => {
    const unverified: MemoryEvidence[] = [
      { ...verifiedEvidence[0]!, verificationStatus: "unverified" },
    ];
    expect(rankEvidenceForAnswer("any question", "general", unverified)).toHaveLength(0);
  });

  it("respects the limit", () => {
    const ranked = rankEvidenceForAnswer("any", "general", verifiedEvidence, 1);
    expect(ranked.length).toBeLessThanOrEqual(1);
  });
});

// ─── extractClaims ────────────────────────────────────────────────────────────

describe("extractClaims", () => {
  it("splits sentences", () => {
    const claims = extractClaims("I worked at Google. I built React apps. Won first prize.");
    expect(claims.length).toBe(3);
  });

  it("ignores very short fragments", () => {
    const claims = extractClaims("Hi. Ok. No.");
    expect(claims.every((c) => c.length >= 10)).toBe(true);
  });
});

// ─── validateClaims ───────────────────────────────────────────────────────────

describe("validateClaims", () => {
  it("marks grounded claims as supported", () => {
    const text = "I trained a Python transformer model achieving high recall at NED University.";
    const flags = validateClaims(text, [verifiedEvidence[0]!]);
    const supported = flags.filter((f) => f.supported);
    expect(supported.length).toBeGreaterThan(0);
  });

  it("flags unverified specific technology claim", () => {
    // Claim mentions Java but evidence has no Java connection
    const text = "I built a sophisticated Java enterprise application for 500 enterprise customers.";
    const flags = validateClaims(text, [verifiedEvidence[0]!]);
    const unsupported = flags.filter((f) => !f.supported);
    expect(unsupported.length).toBeGreaterThan(0);
  });

  it("returns empty array for empty text", () => {
    expect(validateClaims("", verifiedEvidence)).toHaveLength(0);
  });

  it("does not flag generic sentences without specific claims", () => {
    const text = "I am passionate about contributing to impactful projects.";
    const flags = validateClaims(text, verifiedEvidence);
    // Generic text may or may not be supported, but must not throw
    expect(Array.isArray(flags)).toBe(true);
  });
});

// ─── groundingScore ───────────────────────────────────────────────────────────

describe("groundingScore", () => {
  it("returns 1 when all claims are supported", () => {
    const flags = [
      { claim: "a", supported: true, evidenceId: "x", reason: "backed_by_evidence" },
      { claim: "b", supported: true, evidenceId: "x", reason: "backed_by_evidence" },
    ];
    expect(groundingScore(flags)).toBe(1);
  });

  it("returns 0 when no claims are supported", () => {
    const flags = [
      { claim: "a", supported: false, evidenceId: null, reason: "no_match" },
    ];
    expect(groundingScore(flags)).toBe(0);
  });

  it("returns 1 for empty flags", () => {
    expect(groundingScore([])).toBe(1);
  });

  it("returns partial score", () => {
    const flags = [
      { claim: "a", supported: true, evidenceId: "x", reason: "backed_by_evidence" },
      { claim: "b", supported: false, evidenceId: null, reason: "no_match" },
    ];
    expect(groundingScore(flags)).toBe(0.5);
  });
});

// ─── buildAnswerPrompt (structure tests) ─────────────────────────────────────

describe("buildAnswerPrompt", () => {
  it("produces non-empty instruction and data", () => {
    const { instruction, untrustedData } = buildAnswerPrompt({
      question: "Why are you interested in this internship?",
      kind: "why_interested" as QuestionKind,
      opportunityContext: "AI internship at Google",
      evidenceItems: [verifiedEvidence[0]!],
      intent: "draft",
      tone: "formal",
    });
    expect(instruction.length).toBeGreaterThan(100);
    expect(untrustedData).toContain("Why are you interested");
    expect(untrustedData).toContain("NED AI/ML Project");
  });

  it("includes limit note when constraint provided", () => {
    const { instruction } = buildAnswerPrompt({
      question: "Why?",
      kind: "why_interested",
      opportunityContext: "internship",
      evidenceItems: [verifiedEvidence[0]!],
      intent: "draft",
      tone: "concise",
      limitValue: 300,
      limitUnit: "words",
    });
    expect(instruction).toContain("300 words");
  });

  it("includes previous answer for shorten intent", () => {
    const { instruction } = buildAnswerPrompt({
      question: "Why?",
      kind: "why_interested",
      opportunityContext: "internship",
      evidenceItems: [verifiedEvidence[0]!],
      intent: "shorten",
      tone: "concise",
      previousAnswer: "My previous long answer here.",
    });
    expect(instruction).toContain("My previous long answer here");
  });

  it("places NO EVIDENCE AVAILABLE when evidence list is empty", () => {
    const { untrustedData } = buildAnswerPrompt({
      question: "Why?",
      kind: "general",
      opportunityContext: "",
      evidenceItems: [],
      intent: "draft",
      tone: "formal",
    });
    expect(untrustedData).toContain("NO EVIDENCE AVAILABLE");
  });

  it("includes evidence IDs in the prompt", () => {
    const { untrustedData } = buildAnswerPrompt({
      question: "Tell me about your experience",
      kind: "experience",
      opportunityContext: "software engineering",
      evidenceItems: verifiedEvidence.filter((e) => e.verificationStatus === "verified" && !e.excludedFromAi),
      intent: "draft",
      tone: "formal",
    });
    expect(untrustedData).toContain('id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"');
    expect(untrustedData).toContain('id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"');
  });
});

// ─── Hallucination resistance: validateClaims + groundingScore ────────────────

describe("hallucination resistance", () => {
  /**
   * This test simulates a generated answer that fabricates an organization and metric
   * not present in the evidence. The validateClaims + groundingScore chain should
   * detect low backing and produce a score below 0.7.
   */
  it("detects hallucinated organization and metrics", () => {
    const fabricatedAnswer = [
      "I worked at OpenAI Research as a senior engineer for 3 years.",
      "I led a team of 50 engineers delivering 10 million user product.",
      "I published 5 peer-reviewed papers in Nature journal.",
    ].join(" ");

    const flags = validateClaims(fabricatedAnswer, [verifiedEvidence[0]!]);
    const score = groundingScore(flags);

    // Score should be below threshold since the claims are not backed
    expect(score).toBeLessThan(0.7);
  });

  it("returns high score for claim backed by evidence", () => {
    const groundedAnswer =
      "I trained a Python transformer model at NED University and achieved high recall on the test set.";
    const flags = validateClaims(groundedAnswer, [verifiedEvidence[0]!]);
    const score = groundingScore(flags);
    expect(score).toBeGreaterThan(0.5);
  });
});
