import { eligibleEvidence, evidenceBlob, type MemoryEvidence } from "./intelligence-types";
import { overlapScore, tokenize } from "./text";

// ─── Question types ──────────────────────────────────────────────────────────

export type QuestionKind =
  | "why_interested"
  | "why_selected"
  | "experience"
  | "achievement"
  | "motivation"
  | "goals"
  | "contribution"
  | "challenge"
  | "leadership"
  | "research"
  | "general";

const QUESTION_SIGNALS: Record<QuestionKind, string[]> = {
  why_interested: ["interest", "passionate", "drawn", "appeal", "excited", "why apply", "why this"],
  why_selected: ["selected", "choose", "best candidate", "suited", "qualified", "why you", "why should"],
  experience: ["experience", "background", "worked", "role", "position", "previous"],
  achievement: ["achievement", "accomplish", "proud", "impact", "result", "success"],
  motivation: ["motivate", "drive", "inspire", "goal", "aspire", "ambition"],
  goals: ["goal", "career", "plan", "future", "objective", "long-term", "short-term"],
  contribution: ["contribute", "bring", "add", "offer", "impact", "value"],
  challenge: ["challenge", "difficult", "obstacle", "overcome", "problem", "fail"],
  leadership: ["lead", "team", "manage", "coordinate", "organize", "mentor"],
  research: ["research", "publication", "thesis", "study", "investigate", "academic"],
  general: [],
};

export function classifyQuestion(prompt: string): QuestionKind {
  const lower = prompt.toLowerCase();
  let best: QuestionKind = "general";
  let bestScore = 0;
  for (const [kind, signals] of Object.entries(QUESTION_SIGNALS) as [QuestionKind, string[]][]) {
    const score = signals.filter((s) => lower.includes(s)).length;
    if (score > bestScore) {
      bestScore = score;
      best = kind;
    }
  }
  return best;
}

// ─── Evidence ranking for questions ─────────────────────────────────────────

export function rankEvidenceForAnswer(
  question: string,
  kind: QuestionKind,
  evidence: MemoryEvidence[],
  limit = 6,
): MemoryEvidence[] {
  const eligible = eligibleEvidence(evidence);
  if (eligible.length === 0) return [];

  // Boost evidence based on question kind affinity
  const KIND_BOOSTS: Partial<Record<QuestionKind, string[]>> = {
    why_interested: ["project", "achievement", "research"],
    why_selected: ["achievement", "employment", "project", "leadership"],
    experience: ["employment", "project", "leadership", "volunteering"],
    achievement: ["achievement", "project", "employment"],
    motivation: ["project", "research", "achievement"],
    goals: ["project", "research", "education"],
    contribution: ["project", "employment", "leadership", "achievement"],
    challenge: ["employment", "project", "leadership"],
    leadership: ["leadership", "employment", "volunteering"],
    research: ["research", "education", "project"],
  };
  const boostKinds = KIND_BOOSTS[kind] ?? [];

  return eligible
    .map((item) => {
      let score = overlapScore(question, evidenceBlob(item));
      if (boostKinds.includes(item.kind)) score += 0.15;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => e.item);
}

// ─── Claim validation ────────────────────────────────────────────────────────

export type ClaimFlag = {
  claim: string;
  supported: boolean;
  evidenceId: string | null;
  reason: string;
};

/**
 * Extracts candidate factual claims from answer text.
 * Looks for sentences that contain potentially verifiable facts.
 */
export function extractClaims(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 10);
}

const TECH_PATTERNS =
  /\b(python|java|typescript|javascript|react|node|sql|tensorflow|pytorch|aws|azure|gcp|docker|kubernetes|git|rust|golang|c\+\+)\b/gi;
const METRIC_PATTERNS = /\b\d+[\s%x+]*(percent|%|users|customers|hours|days|weeks|months|years|x|times|team|members|projects?|lines?)\b/gi;
const ORG_PATTERNS = /\b(at|with|for|from)\s+[A-Z][a-zA-Z\s&.,-]{2,40}(?=\s*[,.(]|\s+(?:as|in|during|where|which)|\s*$)/g;

/**
 * Validate claims in an answer against the set of cited evidence items.
 * Returns a flag for each claim with whether it is backed by evidence.
 */
export function validateClaims(
  answerText: string,
  evidenceItems: MemoryEvidence[],
): ClaimFlag[] {
  const claims = extractClaims(answerText);
  if (claims.length === 0) return [];

  const evidenceCorpus = evidenceItems.map((e) => ({
    id: e.id,
    blob: evidenceBlob(e).toLowerCase(),
    tokens: new Set(tokenize(evidenceBlob(e))),
  }));

  return claims.map((claim) => {
    const lowerClaim = claim.toLowerCase();
    const claimTokens = new Set(tokenize(lowerClaim));

    // Check technologies mentioned
    const techMatches = [...(claim.match(TECH_PATTERNS) ?? [])].map((t) => t.toLowerCase());
    // Check metrics
    const metricMatches = claim.match(METRIC_PATTERNS) ?? [];
    // Check orgs
    const orgMatches = claim.match(ORG_PATTERNS) ?? [];

    // A claim is supported if any evidence item shares enough tokens with it
    let bestEvidenceId: string | null = null;
    let bestOverlap = 0;

    for (const ev of evidenceCorpus) {
      const intersection = [...claimTokens].filter((t) => ev.tokens.has(t)).length;
      const union = new Set([...claimTokens, ...ev.tokens]).size;
      const jaccard = union > 0 ? intersection / union : 0;
      if (jaccard > bestOverlap) {
        bestOverlap = jaccard;
        bestEvidenceId = ev.id;
      }
    }

    // Specific claims (tech, metrics, orgs) require stronger backing
    const isSpecific = techMatches.length > 0 || metricMatches.length > 0 || orgMatches.length > 0;
    const threshold = isSpecific ? 0.08 : 0.05;
    const supported = bestOverlap >= threshold;

    if (supported) {
      return { claim, supported: true, evidenceId: bestEvidenceId, reason: "backed_by_evidence" };
    }

    let reason = "low_evidence_overlap";
    if (techMatches.length > 0) reason = `unverified_technology: ${techMatches.join(", ")}`;
    if (metricMatches.length > 0) reason = `unverified_metric: ${metricMatches[0]}`;
    if (orgMatches.length > 0) reason = `unverified_organization`;

    return { claim, supported: false, evidenceId: null, reason };
  });
}

/**
 * Counts unsupported claims. Used for grounding score.
 */
export function groundingScore(flags: ClaimFlag[]): number {
  if (flags.length === 0) return 1;
  const supported = flags.filter((f) => f.supported).length;
  return supported / flags.length;
}

// ─── Answer state ────────────────────────────────────────────────────────────

export type AnswerState =
  | "ai_generated"
  | "user_edited"
  | "approved"
  | "rejected"
  | "needs_review";

export type GenerationIntent = "draft" | "shorten" | "expand" | "adjust_tone";

export type ToneStyle = "formal" | "enthusiastic" | "concise" | "detailed";

export function toneInstruction(tone: ToneStyle): string {
  switch (tone) {
    case "formal":
      return "Write in formal professional English. Avoid casual language.";
    case "enthusiastic":
      return "Write with genuine enthusiasm and energy while remaining professional.";
    case "concise":
      return "Be concise. Remove filler. Every sentence must add value.";
    case "detailed":
      return "Be thorough and detailed. Explain context and reasoning clearly.";
  }
}

// ─── Prompt assembly ─────────────────────────────────────────────────────────

export function buildAnswerPrompt(input: {
  question: string;
  kind: QuestionKind;
  opportunityContext: string;
  evidenceItems: MemoryEvidence[];
  intent: GenerationIntent;
  tone: ToneStyle;
  limitValue?: number | null;
  limitUnit?: string | null;
  previousAnswer?: string | null;
}): { instruction: string; untrustedData: string } {
  const { question, kind, opportunityContext, evidenceItems, intent, tone, limitValue, limitUnit, previousAnswer } = input;

  const evidenceSections = evidenceItems.map((e, i) => {
    const lines = [
      `EVIDENCE_${i + 1} id="${e.id}"`,
      `  title: ${e.title}`,
      `  kind: ${e.kind}`,
      e.organization ? `  organization: ${e.organization}` : null,
      e.situation ? `  situation: ${e.situation}` : null,
      e.action ? `  action: ${e.action}` : null,
      e.outcome ? `  outcome: ${e.outcome}` : null,
      e.skills.length > 0 ? `  skills: ${e.skills.join(", ")}` : null,
      e.startDate ? `  startDate: ${e.startDate}` : null,
      e.endDate ? `  endDate: ${e.endDate}` : null,
    ].filter(Boolean);
    return lines.join("\n");
  });

  const limitNote =
    limitValue && limitUnit
      ? `\nLength constraint: max ${limitValue} ${limitUnit}.`
      : "";

  const intentNote: Record<GenerationIntent, string> = {
    draft: "Write a complete answer grounded in the evidence below.",
    shorten: `Shorten this answer while keeping all factual claims backed by evidence:\n"""\n${previousAnswer ?? ""}\n"""`,
    expand: `Expand this answer with more detail, still grounded in evidence:\n"""\n${previousAnswer ?? ""}\n"""`,
    adjust_tone: `Rewrite this answer with the requested tone, keeping all facts:\n"""\n${previousAnswer ?? ""}\n"""`,
  };

  const instruction = [
    `You are a grounded application-answer writer for a job/opportunity application system.`,
    ``,
    `RULES (non-negotiable):`,
    `1. Only use facts from the EVIDENCE blocks. Never invent organizations, technologies, metrics, dates, or achievements.`,
    `2. If the evidence is insufficient to write a credible answer, output exactly: {"text":"","evidenceIds":[],"missingFacts":["<what is missing>"],"warnings":["INSUFFICIENT_EVIDENCE"]}`,
    `3. Cite EVERY evidence item you use in evidenceIds using its id attribute.`,
    `4. ${toneInstruction(tone)}`,
    `5. ${intentNote[intent]}${limitNote}`,
    ``,
    `Return JSON with EXACTLY these fields:`,
    `{`,
    `  "text": "<the answer>",`,
    `  "evidenceIds": ["<id>", ...],`,
    `  "missingFacts": ["<what information is missing>", ...],`,
    `  "warnings": ["<any issues>", ...]`,
    `}`,
  ].join("\n");

  const untrustedData = [
    `QUESTION (kind: ${kind}): ${question}`,
    ``,
    `OPPORTUNITY CONTEXT:`,
    opportunityContext.slice(0, 2000),
    ``,
    `EVIDENCE (verified, use only these):`,
    evidenceSections.length > 0 ? evidenceSections.join("\n\n") : "NO EVIDENCE AVAILABLE",
  ].join("\n");

  return { instruction, untrustedData };
}
