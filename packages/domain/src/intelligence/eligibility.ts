import { extractYears, overlapScore, tokenize } from "./text";
import { isWorkAuthorizationRequirement, workAuthorizationMeetsRequirement } from "../work-authorization";
import {
  eligibleEvidence,
  evidenceBlob,
  type CandidateProfile,
  type EligibilityDisplayState,
  type EligibilityState,
  type EligibilityVerdict,
  type MemoryEvidence,
  type MemoryRequirement,
  type RequirementKind,
} from "./types";

const KIND_ALIASES: Record<string, RequirementKind> = {
  education: "education",
  degree: "degree",
  graduation_year: "graduation_year",
  location: "location",
  experience: "experience",
  skill: "skills",
  skills: "skills",
  availability: "availability",
  eligibility: "other",
  document: "other",
  general: "other",
  other: "other",
};

export const ELIGIBILITY_DISPLAY: Record<EligibilityState, EligibilityDisplayState> = {
  met: "SATISFIED",
  not_met: "NOT SATISFIED",
  unclear: "UNKNOWN",
  not_evaluated: "UNKNOWN",
  partial: "PARTIAL",
  needs_confirmation: "NEEDS CONFIRMATION",
};

export function classifyRequirementKind(text: string, existingKind?: string | null): RequirementKind {
  const aliased = existingKind ? KIND_ALIASES[existingKind.toLowerCase()] : undefined;
  const value = text.toLowerCase();

  if (/\b(graduat|class of|batch of)\b/.test(value) || extractYears(value).length > 0 && /graduat|year|after|before|by 20/.test(value)) {
    return "graduation_year";
  }
  if (/\b(bachelor|master|phd|doctorate|degree|bsc|msc|bs\b|ms\b|undergraduate|graduate student)\b/.test(value)) {
    return "degree";
  }
  if (/\b(gpa|enrolled|university|college|school|student|education)\b/.test(value) && aliased !== "experience") {
    return aliased === "education" || !aliased ? "education" : aliased;
  }
  if (/\b(available|availability|full[- ]time|part[- ]time|start date|hours per|immediately)\b/.test(value)) {
    return "availability";
  }
  if (
    /\b(remote|onsite|on-site|hybrid|located|location|based in|authorized|work authorization|citizenship|visa|reloc)\b/.test(
      value,
    )
  ) {
    return "location";
  }
  if (
    /\b(year|years|intern|internship|professional|employment|work experience|prior experience|prior)\b/.test(value)
  ) {
    return "experience";
  }
  if (aliased === "skills" || /\b(skill|proficient|python|javascript|typescript|react|sql)\b/.test(value)) {
    return "skills";
  }
  if (aliased && aliased !== "other") return aliased;
  return "other";
}

function profileLocation(profile?: CandidateProfile | null): string {
  return [profile?.locationCity, profile?.locationCountry, profile?.workAuthorization].filter(Boolean).join(" ");
}

function contradiction(requirement: string, fact: string): boolean {
  const req = new Set(tokenize(requirement));
  const have = new Set(tokenize(fact));
  if (req.size === 0 || have.size === 0) return false;
  const geo = [...req].filter((token) => GEO.has(token));
  const haveGeo = [...have].filter((token) => GEO.has(token));
  if (geo.length === 0 || haveGeo.length === 0) return false;
  return geo.every((token) => !have.has(token)) && haveGeo.every((token) => !req.has(token));
}

const GEO = new Set([
  "zurich",
  "pakistan",
  "karachi",
  "lahore",
  "islamabad",
  "usa",
  "united",
  "states",
  "uk",
  "london",
  "canada",
  "remote",
  "onsite",
  "hybrid",
  "europe",
  "asia",
]);

function verdict(
  requirement: MemoryRequirement,
  kind: RequirementKind,
  state: EligibilityState,
  explanation: string,
  evidenceId: string | null,
): EligibilityVerdict {
  return {
    requirementId: requirement.id,
    requirementText: requirement.text,
    kind,
    hard: requirement.hard,
    state,
    displayState: ELIGIBILITY_DISPLAY[state],
    explanation,
    evidenceId,
  };
}

export function evaluateRequirement(
  requirement: MemoryRequirement,
  evidence: MemoryEvidence[],
  profile?: CandidateProfile | null,
): EligibilityVerdict {
  const kind = classifyRequirementKind(requirement.text, requirement.kind);
  const usable = eligibleEvidence(evidence);
  const profileFacts = {
    location: profileLocation(profile),
    availability: profile?.availability ?? "",
  };

  if (kind === "location") {
    const requirementText = requirement.text;
    const authorization = (profile?.workAuthorization ?? "").trim();
    if (isWorkAuthorizationRequirement(requirementText) || /visa|authorized to work|citizenship/i.test(requirementText)) {
      if (!authorization) {
        return verdict(
          requirement,
          kind,
          "needs_confirmation",
          `Location / work authorization is not specified in your profile. Requirement: ${requirementText}`,
          null,
        );
      }
      const settled = workAuthorizationMeetsRequirement(requirementText, authorization);
      if (settled === "met") {
        return verdict(
          requirement,
          kind,
          "met",
          `Matched your work authorization against: ${requirementText}`,
          null,
        );
      }
      if (settled === "not_met") {
        return verdict(
          requirement,
          kind,
          "not_met",
          `Profile work authorization (${authorization}) conflicts with this requirement. Assistance only — not an official decision.`,
          null,
        );
      }
      return verdict(
        requirement,
        kind,
        "needs_confirmation",
        `Work authorization is on file but does not clearly settle this restriction. Requirement: ${requirementText}`,
        null,
      );
    }
    if (!profileFacts.location) {
      return verdict(
        requirement,
        kind,
        "needs_confirmation",
        `Location / work authorization is not specified in your profile. Requirement: ${requirement.text}`,
        null,
      );
    }
    if (contradiction(requirement.text, profileFacts.location)) {
      return verdict(
        requirement,
        kind,
        "not_met",
        `Profile location (${profileFacts.location}) conflicts with this requirement. Assistance only — not an official decision.`,
        null,
      );
    }
    if (overlapScore(requirement.text, profileFacts.location) >= 0.2 || /remote/.test(requirement.text.toLowerCase())) {
      return verdict(
        requirement,
        kind,
        "met",
        `Matched your profile location/authorization against: ${requirement.text}`,
        null,
      );
    }
    return verdict(
      requirement,
      kind,
      "needs_confirmation",
      `Location is on file but does not clearly satisfy: ${requirement.text}`,
      null,
    );
  }

  if (kind === "availability") {
    if (!profileFacts.availability.trim()) {
      return verdict(
        requirement,
        kind,
        "needs_confirmation",
        `Availability not specified. Requirement: ${requirement.text}`,
        null,
      );
    }
    const score = overlapScore(requirement.text, profileFacts.availability);
    if (contradiction(requirement.text, profileFacts.availability) && score < 0.2) {
      return verdict(
        requirement,
        kind,
        "not_met",
        `Recorded availability (${profileFacts.availability}) conflicts with this requirement.`,
        null,
      );
    }
    if (score >= 0.25) {
      return verdict(requirement, kind, "met", `Matched recorded availability: ${profileFacts.availability}`, null);
    }
    return verdict(
      requirement,
      kind,
      "needs_confirmation",
      `Availability is on file (${profileFacts.availability}) but does not clearly satisfy: ${requirement.text}`,
      null,
    );
  }

  if (kind === "graduation_year") {
    const requiredYears = extractYears(requirement.text);
    const education = usable.filter((item) => item.kind === "education" || item.kind === "certification");
    const evidencedYears = education.flatMap((item) => extractYears(evidenceBlob(item)));
    if (requiredYears.length > 0 && evidencedYears.length === 0) {
      return verdict(
        requirement,
        kind,
        "needs_confirmation",
        `Graduation year is not evidenced. Requirement: ${requirement.text}`,
        null,
      );
    }
    if (requiredYears.length > 0 && evidencedYears.length > 0) {
      const latest = Math.max(...evidencedYears);
      const target = Math.max(...requiredYears);
      const after = /after|later than|on or after|graduat(?:e|ing) after/.test(requirement.text.toLowerCase());
      const before = /before|by /.test(requirement.text.toLowerCase());
      if (after && latest <= target) {
        return verdict(
          requirement,
          kind,
          "not_met",
          `Verified education year ${latest} does not satisfy “${requirement.text}”.`,
          education[0]?.id ?? null,
        );
      }
      if (before && latest > target) {
        return verdict(
          requirement,
          kind,
          "not_met",
          `Verified education year ${latest} does not satisfy “${requirement.text}”.`,
          education[0]?.id ?? null,
        );
      }
      if (evidencedYears.some((year) => requiredYears.includes(year)) || (after && latest > target) || (before && latest <= target)) {
        return verdict(
          requirement,
          kind,
          "met",
          `Verified education year ${latest} supports this graduation-year requirement.`,
          education[0]?.id ?? null,
        );
      }
    }
  }

  if (usable.length === 0) {
    return verdict(
      requirement,
      kind,
      "unclear",
      `No verified evidence is available to evaluate: ${requirement.text}`,
      null,
    );
  }

  let best: { item: MemoryEvidence; score: number } | null = null;
  for (const item of usable) {
    const score = overlapScore(requirement.text, evidenceBlob(item));
    if (!best || score > best.score) best = { item, score };
  }

  if (!best || best.score < 0.15) {
    return verdict(
      requirement,
      kind,
      "unclear",
      `Not enough verified evidence to decide. Requirement: ${requirement.text}. This is not an official eligibility decision.`,
      null,
    );
  }

  if (best.score >= 0.34) {
    return verdict(
      requirement,
      kind,
      "met",
      `Satisfied from verified evidence “${best.item.title}”. Assistance only — not an official decision.`,
      best.item.id,
    );
  }

  return verdict(
    requirement,
    kind,
    "partial",
    `Partial overlap with verified evidence “${best.item.title}”, but the requirement is not fully evidenced.`,
    best.item.id,
  );
}

export function evaluateEligibility(
  requirements: MemoryRequirement[],
  evidence: MemoryEvidence[],
  profile?: CandidateProfile | null,
): EligibilityVerdict[] {
  if (requirements.length === 0) {
    return [
      {
        requirementId: "none",
        requirementText: "No explicit requirements were extracted.",
        kind: "other",
        hard: false,
        state: "not_evaluated",
        displayState: "UNKNOWN",
        explanation: "No explicit requirements were extracted. Add them before treating this as a fit check.",
        evidenceId: null,
      },
    ];
  }
  return requirements.map((requirement) => evaluateRequirement(requirement, evidence, profile));
}
