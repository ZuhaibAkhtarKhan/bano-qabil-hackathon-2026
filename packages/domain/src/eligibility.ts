import type { EligibilityState } from "@1apply/contracts";

import {
  eligibleEvidence,
  evidenceBlob,
  verifiedFacts,
  verifiedSkills,
  type EligibilityContext,
  type EligibilityVerdict,
  type MemoryEvidence,
  type MemoryRequirement,
} from "./intelligence-types";
import { extractYears, includesAny, overlapScore, tokenize } from "./text";
import {
  isWorkAuthorizationRequirement,
  workAuthorizationMeetsRequirement,
} from "./work-authorization";

export const ELIGIBILITY_LABELS: Record<EligibilityState, string> = {
  met: "Satisfied",
  not_met: "Not satisfied",
  partial: "Partial",
  unclear: "Unknown / needs confirmation",
  needs_confirmation: "Needs confirmation",
  not_evaluated: "Not evaluated",
};

export function eligibilityLabel(state: EligibilityState | string): string {
  return ELIGIBILITY_LABELS[state as EligibilityState] ?? "Unknown / needs confirmation";
}

const REQUIREMENT_KINDS = [
  "eligibility",
  "education",
  "skill",
  "experience",
  "location",
  "availability",
  "document",
  "general",
] as const;

export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

const DEGREE_RANK = {
  high_school: 1,
  undergraduate: 2,
  master: 3,
  phd: 4,
} as const;

type DegreeLevel = keyof typeof DEGREE_RANK;

function verdict(
  requirement: MemoryRequirement,
  kind: string,
  state: EligibilityState,
  explanation: string,
  evidenceId: string | null = null,
): EligibilityVerdict {
  return {
    requirementId: requirement.id,
    requirementText: requirement.text,
    kind,
    hard: requirement.hard,
    state,
    label: eligibilityLabel(state),
    explanation,
    evidenceId,
    needsConfirmation: state === "unclear" || state === "not_evaluated" || state === "needs_confirmation",
  };
}

export function inferRequirementKind(requirement: MemoryRequirement): RequirementKind {
  const stored = (requirement.kind ?? "").toLowerCase();
  if (REQUIREMENT_KINDS.includes(stored as RequirementKind) && stored !== "general" && stored !== "eligibility") {
    return stored as RequirementKind;
  }

  const text = requirement.text.toLowerCase();
  if (includesAny(text, ["transcript", "resume", "cover letter", "certificate", "portfolio", "cv"])) {
    return "document";
  }
  if (includesAny(text, ["available", "availability", "start date", "full-time", "part-time", "hours per"])) {
    return "availability";
  }
  if (includesAny(text, ["remote", "on-site", "onsite", "in-person", "reloc", "based in", "located", "visa", "work authorization", "authorized to work", "work permit", "citizen"])) {
    return "location";
  }
  if (includesAny(text, ["degree", "bachelor", "undergraduate", "master", "phd", "doctorate", "gpa", "graduat", "university", "college"])) {
    return "education";
  }
  if (includesAny(text, ["year of experience", "years of", "professional", "internship experience", "work experience"])) {
    return "experience";
  }
  if (stored === "skill" || text.startsWith("skill:")) return "skill";
  if (stored === "eligibility") return "eligibility";
  return stored === "general" ? "general" : "general";
}

export function isPreferredRequirement(requirement: MemoryRequirement): boolean {
  if (!requirement.hard && /prefer|nice to have|plus\b|bonus/i.test(requirement.text)) return true;
  return !requirement.hard && /prefer/i.test(requirement.text);
}

function bestOverlap(
  requirementText: string,
  evidence: MemoryEvidence[],
): { item: MemoryEvidence; score: number } | null {
  let best: { item: MemoryEvidence; score: number } | null = null;
  for (const item of evidence) {
    const score = overlapScore(requirementText, evidenceBlob(item));
    if (!best || score > best.score) best = { item, score };
  }
  return best;
}

function detectDegree(text: string): DegreeLevel | null {
  const lower = text.toLowerCase();
  if (includesAny(lower, ["phd", "ph.d", "doctorate", "doctoral"])) return "phd";
  if (includesAny(lower, ["master", "msc", "m.s", "mba", "graduate degree"])) return "master";
  if (includesAny(lower, ["bachelor", "undergraduate", "undergrad", "bsc", "b.s", "b.a", "bs ", "ba "])) {
    return "undergraduate";
  }
  if (includesAny(lower, ["high school", "secondary school"])) return "high_school";
  return null;
}

function educationCorpus(item: MemoryEvidence): string {
  return [item.title, item.organization, item.situation, item.outcome, item.startDate, item.endDate]
    .filter(Boolean)
    .join(" ");
}

function evaluateEducation(
  requirement: MemoryRequirement,
  kind: string,
  usable: MemoryEvidence[],
  context: EligibilityContext,
): EligibilityVerdict {
  const education = usable.filter((item) => item.kind === "education" || item.kind === "certification");
  const factText = verifiedFacts(context.facts)
    .filter((item) => item.category === "education")
    .map((item) => item.value)
    .join(" ");
  const blob = [...education.map(educationCorpus), factText].join(" ");
  const related = education;
  const requiredDegree = detectDegree(requirement.text);
  const evidencedDegree = detectDegree(blob);
  const requiredYears = extractYears(requirement.text);
  const evidencedYears = extractYears(blob);

  if (requiredYears.length > 0) {
    if (evidencedYears.length === 0) {
      return verdict(
        requirement,
        kind,
        "unclear",
        `Graduation year is not specified in verified Application Memory. Requirement: ${requirement.text}`,
      );
    }
    const reqYear = requiredYears[0]!;
    const latest = Math.max(...evidencedYears);
    const after = /after|later than|on or after/i.test(requirement.text);
    const before = /before|no later|by \d{4}/i.test(requirement.text);
    const evidenceId = related.find((item) => extractYears(educationCorpus(item)).length > 0)?.id ?? null;

    if (after) {
      return latest > reqYear
        ? verdict(requirement, kind, "met", `Verified graduation/end year ${latest} is after ${reqYear}. Requirement: ${requirement.text}`, evidenceId)
        : verdict(requirement, kind, "not_met", `Verified year ${latest} does not satisfy “after ${reqYear}”. Requirement: ${requirement.text}`, evidenceId);
    }
    if (before) {
      return latest < reqYear
        ? verdict(requirement, kind, "met", `Verified year ${latest} is before ${reqYear}. Requirement: ${requirement.text}`, evidenceId)
        : verdict(requirement, kind, "not_met", `Verified year ${latest} is not before ${reqYear}. Requirement: ${requirement.text}`, evidenceId);
    }
    if (evidencedYears.includes(reqYear)) {
      return verdict(requirement, kind, "met", `Verified education year ${reqYear} matches. Requirement: ${requirement.text}`, evidenceId);
    }
    return verdict(
      requirement,
      kind,
      "not_met",
      `Verified education year ${latest} conflicts with required ${reqYear}. Requirement: ${requirement.text}`,
      evidenceId,
    );
  }

  if (requiredDegree) {
    if (!evidencedDegree) {
      return verdict(
        requirement,
        kind,
        "unclear",
        `Degree level is not specified in verified Application Memory. Requirement: ${requirement.text}`,
      );
    }
    const evidenceId = related.find((item) => detectDegree(educationCorpus(item)) === evidencedDegree)?.id ?? null;
    if (DEGREE_RANK[evidencedDegree] >= DEGREE_RANK[requiredDegree]) {
      return verdict(
        requirement,
        kind,
        "met",
        `Verified ${evidencedDegree.replace("_", " ")} evidence satisfies this education requirement. Requirement: ${requirement.text}`,
        evidenceId,
      );
    }
    return verdict(
      requirement,
      kind,
      "not_met",
      `Verified education is ${evidencedDegree.replace("_", " ")}, which does not meet ${requiredDegree.replace("_", " ")}. Requirement: ${requirement.text}`,
      evidenceId,
    );
  }

  const best = bestOverlap(requirement.text, related.length > 0 ? related : usable);
  if (best && best.score >= 0.34) {
    return verdict(
      requirement,
      kind,
      "met",
      `Matched verified evidence: ${best.item.title}. Requirement: ${requirement.text}`,
      best.item.id,
    );
  }
  return verdict(requirement, kind, "unclear", `Not enough verified education evidence to decide. Requirement: ${requirement.text}`);
}

function evaluateSkill(
  requirement: MemoryRequirement,
  kind: string,
  usable: MemoryEvidence[],
  context: EligibilityContext,
): EligibilityVerdict {
  const named = requirement.text.replace(/^skill:\s*/i, "").trim();
  const skills = verifiedSkills(usable, context.facts);
  const requiredTokens = tokenize(named);
  const matched = requiredTokens.filter((token) => skills.some((skill) => skill.toLowerCase().includes(token) || token.includes(skill.toLowerCase())));
  const best = bestOverlap(named, usable);

  if (matched.length > 0 && (requiredTokens.length === 0 || matched.length / Math.max(requiredTokens.length, 1) >= 0.5)) {
    return verdict(
      requirement,
      kind,
      "met",
      `Verified skills cover ${matched.join(", ")}. Requirement: ${requirement.text}`,
      best?.item.id ?? null,
    );
  }
  if (best && best.score >= 0.34) {
    return verdict(
      requirement,
      kind,
      "met",
      `Matched verified evidence: ${best.item.title}. Requirement: ${requirement.text}`,
      best.item.id,
    );
  }
  if (best && best.score >= 0.15) {
    return verdict(
      requirement,
      kind,
      "partial",
      `Possible overlap with ${best.item.title}, but the named skill is not clearly evidenced. Requirement: ${requirement.text}`,
      best.item.id,
    );
  }
  if (skills.length === 0) {
    return verdict(requirement, kind, "unclear", `No verified skills in Application Memory. Requirement: ${requirement.text}`);
  }
  return verdict(
    requirement,
    kind,
    "unclear",
    `Verified memory does not clearly include this skill. This is not treated as a miss. Requirement: ${requirement.text}`,
  );
}

function evaluateExperience(
  requirement: MemoryRequirement,
  kind: string,
  usable: MemoryEvidence[],
): EligibilityVerdict {
  const professional = /professional|full-time|years of|year of|internship experience|work experience/i.test(requirement.text);
  const preferred = isPreferredRequirement(requirement);
  const employment = usable.filter((item) => item.kind === "employment" || item.kind === "leadership" || item.kind === "volunteering");
  const projects = usable.filter((item) => item.kind === "project" || item.kind === "research" || item.kind === "achievement");
  const pool = employment.length > 0 ? employment : usable;
  const best = bestOverlap(requirement.text, pool);

  if (best && best.score >= 0.34 && (!professional || employment.some((item) => item.id === best.item.id))) {
    return verdict(
      requirement,
      kind,
      "met",
      `Matched verified ${best.item.kind}: ${best.item.title}. Requirement: ${requirement.text}`,
      best.item.id,
    );
  }

  const projectBest = bestOverlap(requirement.text, projects);
  if (professional && projectBest && projectBest.score >= 0.2) {
    const state: EligibilityState = preferred ? "unclear" : "partial";
    return verdict(
      requirement,
      kind,
      state,
      preferred
        ? `Professional experience is preferred and not clearly evidenced. Related project: ${projectBest.item.title}. Requirement: ${requirement.text}`
        : `Verified project “${projectBest.item.title}” is related, but professional/internship experience is not evidenced. Requirement: ${requirement.text}`,
      projectBest.item.id,
    );
  }

  if (best && best.score >= 0.15) {
    return verdict(
      requirement,
      kind,
      "unclear",
      `Possible overlap with ${best.item.title}, but the requirement is not clearly evidenced. Requirement: ${requirement.text}`,
      best.item.id,
    );
  }

  return verdict(
    requirement,
    kind,
    "unclear",
    `Not enough verified experience to decide. This is not an official eligibility decision. Requirement: ${requirement.text}`,
  );
}

function combinedWorkAuthorization(context: EligibilityContext): string {
  const fromFacts = (context.facts ?? [])
    .filter((fact) => fact.verificationStatus !== "rejected")
    .map((fact) => fact.value)
    .filter((value) =>
      /\b(visa|authoriz|citizen|eligib|green card|sponsorship|work permit|h-?1b|\bopt\b|\bead\b)\b/i.test(value),
    );
  return [context.workAuthorization, ...fromFacts].filter(Boolean).join(" ").trim();
}

function evaluateLocation(
  requirement: MemoryRequirement,
  kind: string,
  context: EligibilityContext,
): EligibilityVerdict {
  const text = requirement.text;
  const remote = /remote|anywhere|worldwide|work from home/i.test(text) || /remote/i.test(context.opportunityLocation ?? "");
  const city = (context.locationCity ?? "").trim();
  const country = (context.locationCountry ?? "").trim();
  const authorization = combinedWorkAuthorization(context);
  const profile = `${city} ${country} ${authorization}`.trim();

  if (isWorkAuthorizationRequirement(text) || /visa|work authorization|citizen|authorized to work/i.test(text)) {
    if (!authorization) {
      return verdict(requirement, kind, "unclear", `Work authorization is not specified in Application Memory. Requirement: ${text}`);
    }
    const settled = workAuthorizationMeetsRequirement(text, authorization);
    if (settled === "met") {
      return verdict(requirement, kind, "met", `Applicant work authorization “${authorization}” meets this restriction. Requirement: ${text}`);
    }
    if (settled === "not_met") {
      return verdict(requirement, kind, "not_met", `Recorded work authorization “${authorization}” does not meet this restriction. Requirement: ${text}`);
    }
    return verdict(requirement, kind, "unclear", `Work authorization is on file but does not clearly settle this restriction. Requirement: ${text}`);
  }

  if (remote && !/on-site|onsite|in-person|must be (in|located)/i.test(text)) {
    return verdict(requirement, kind, "met", `Opportunity/requirement allows remote work. Requirement: ${text}`);
  }

  if (!city && !country) {
    return verdict(requirement, kind, "unclear", `Location is not specified in Application Memory. Requirement: ${text}`);
  }

  if (overlapScore(text, profile) >= 0.25 || includesAny(text.toLowerCase(), [city.toLowerCase(), country.toLowerCase()].filter(Boolean))) {
    return verdict(requirement, kind, "met", `Verified location ${[city, country].filter(Boolean).join(", ")} matches. Requirement: ${text}`);
  }

  const namedPlace = tokenize(text).filter((token) => token.length > 3);
  const profileTokens = new Set(tokenize(profile));
  const conflicting = namedPlace.filter((token) => !profileTokens.has(token) && !["remote", "based", "located", "office"].includes(token));
  if (!remote && conflicting.length > 0 && (city || country) && /must|only|required|on-site|onsite|in-person/.test(text.toLowerCase())) {
    return verdict(
      requirement,
      kind,
      "not_met",
      `Verified location ${[city, country].filter(Boolean).join(", ")} does not match this on-site restriction. Requirement: ${text}`,
    );
  }

  return verdict(
    requirement,
    kind,
    "unclear",
    `Location is on file (${[city, country].filter(Boolean).join(", ") || "unspecified"}) but does not clearly settle this requirement. Requirement: ${text}`,
  );
}

function evaluateAvailability(
  requirement: MemoryRequirement,
  kind: string,
  context: EligibilityContext,
): EligibilityVerdict {
  const availability = (context.availability ?? "").trim();
  if (!availability) {
    return verdict(
      requirement,
      kind,
      "unclear",
      `Availability is not specified in Application Memory. Requirement: ${requirement.text}`,
    );
  }
  if (overlapScore(requirement.text, availability) >= 0.2 || tokenize(availability).some((token) => requirement.text.toLowerCase().includes(token))) {
    return verdict(requirement, kind, "met", `Verified availability “${availability}” overlaps this requirement. Requirement: ${requirement.text}`);
  }
  return verdict(
    requirement,
    kind,
    "unclear",
    `Availability is on file (“${availability}”) but does not clearly settle this requirement. Requirement: ${requirement.text}`,
  );
}

function evaluateDocument(
  requirement: MemoryRequirement,
  kind: string,
  context: EligibilityContext,
): EligibilityVerdict {
  const documents = context.documents ?? [];
  if (documents.length === 0) {
    return verdict(requirement, kind, "unclear", `No documents are in the vault yet. Requirement: ${requirement.text}`);
  }
  const text = requirement.text.toLowerCase();
  const match = documents.find((document) => {
    const type = document.type.replace(/_/g, " ");
    return text.includes(type) || overlapScore(requirement.text, `${document.label} ${document.type}`) >= 0.25;
  });
  if (match) {
    return verdict(requirement, kind, "met", `Vault contains “${match.label}” (${match.type.replace(/_/g, " ")}). Requirement: ${requirement.text}`);
  }
  return verdict(
    requirement,
    kind,
    "unclear",
    `No matching document type is clearly in the vault. This is not treated as a miss. Requirement: ${requirement.text}`,
  );
}

function evaluateLexical(
  requirement: MemoryRequirement,
  kind: string,
  usable: MemoryEvidence[],
): EligibilityVerdict {
  if (usable.length === 0) {
    return verdict(
      requirement,
      kind,
      "unclear",
      `No verified evidence is available to evaluate this requirement. Requirement: ${requirement.text}`,
    );
  }

  const best = bestOverlap(requirement.text, usable);
  if (!best || best.score < 0.15) {
    return verdict(
      requirement,
      kind,
      "unclear",
      `Not enough verified evidence to decide. This is not an official eligibility decision. Requirement: ${requirement.text}`,
    );
  }
  if (best.score >= 0.34) {
    return verdict(
      requirement,
      kind,
      "met",
      `Matched verified evidence: ${best.item.title}. Assistance only — not an official decision. Requirement: ${requirement.text}`,
      best.item.id,
    );
  }
  return verdict(
    requirement,
    kind,
    "unclear",
    `Possible overlap with ${best.item.title}, but the requirement is not clearly evidenced. Requirement: ${requirement.text}`,
    best.item.id,
  );
}

export function evaluateRequirement(
  requirement: MemoryRequirement,
  evidence: MemoryEvidence[],
  context: EligibilityContext = {},
): EligibilityVerdict {
  const usable = eligibleEvidence(evidence);
  const kind = inferRequirementKind(requirement);

  switch (kind) {
    case "education":
      return evaluateEducation(requirement, kind, usable, context);
    case "skill":
      return evaluateSkill(requirement, kind, usable, context);
    case "experience":
      return evaluateExperience(requirement, kind, usable);
    case "location":
      return evaluateLocation(requirement, kind, context);
    case "availability":
      return evaluateAvailability(requirement, kind, context);
    case "document":
      return evaluateDocument(requirement, kind, context);
    default:
      if (kind === "eligibility") {
        const educationLike = /graduat|degree|bachelor|undergraduate|master|phd/i.test(requirement.text);
        const locationLike = /remote|on-site|located|visa|citizen|authoriz/i.test(requirement.text);
        const availabilityLike = /available|availability|start date|full-time/i.test(requirement.text);
        if (educationLike) return evaluateEducation(requirement, kind, usable, context);
        if (locationLike) return evaluateLocation(requirement, kind, context);
        if (availabilityLike) return evaluateAvailability(requirement, kind, context);
      }
      return evaluateLexical(requirement, kind, usable);
  }
}

export function evaluateEligibility(
  requirements: MemoryRequirement[],
  evidence: MemoryEvidence[],
  context: EligibilityContext = {},
): EligibilityVerdict[] {
  if (requirements.length === 0) {
    return [
      {
        requirementId: "none",
        requirementText: "No explicit requirements were extracted.",
        kind: "general",
        hard: false,
        state: "not_evaluated",
        label: eligibilityLabel("not_evaluated"),
        explanation: "No explicit requirements were extracted. Add them before treating this as a fit check.",
        evidenceId: null,
        needsConfirmation: true,
      },
    ];
  }
  return requirements.map((requirement) => evaluateRequirement(requirement, evidence, context));
}

export function eligibilityFactorScore(verdicts: EligibilityVerdict[]): number {
  const evaluated = verdicts.filter((item) => item.state !== "not_evaluated");
  if (evaluated.length === 0) return 0;
  const points = evaluated.reduce((sum, item) => {
    if (item.state === "met") return sum + 1;
    if (item.state === "partial") return sum + 0.5;
    return sum;
  }, 0);
  return Math.round((points / evaluated.length) * 100);
}
