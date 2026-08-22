import { describe, expect, it } from "vitest";

import { rankEvidenceForAnswer } from "../src/answer-generation";
import type { MemoryEvidence } from "../src/intelligence-types";
import { parsePersona, personaBoostKinds } from "../src/persona";
import { suggestPreviousAnswers } from "../src/previous-answers";

const research: MemoryEvidence = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Published paper",
  kind: "research",
  organization: "NED University",
  situation: "Wrote a methods section",
  action: "Ran an experiment",
  outcome: "Accepted workshop paper",
  skills: ["python"],
  verificationStatus: "verified",
  excludedFromAi: false,
};

const leadership: MemoryEvidence = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Chapter lead",
  kind: "leadership",
  organization: "IEEE",
  situation: "Coordinated a team",
  action: "Ran weekly standups",
  outcome: "Shipped a campus event",
  skills: ["communication"],
  verificationStatus: "verified",
  excludedFromAi: false,
};

describe("persona presets", () => {
  it("parses known ids and ignores unknown values", () => {
    expect(parsePersona("academic")).toBe("academic");
    expect(parsePersona("nope")).toBeNull();
    expect(personaBoostKinds("leadership")).toContain("leadership");
  });

  it("boosts matching evidence kinds for the selected persona", () => {
    const ranked = rankEvidenceForAnswer("tell us about yourself", "general", [research, leadership], 2, "academic");
    expect(ranked[0]?.id).toBe(research.id);
  });
});

describe("suggestPreviousAnswers", () => {
  it("ranks approved answers by overlap with the new prompt", () => {
    const ranked = suggestPreviousAnswers("Why are you interested in machine learning research?", [
      {
        id: "a",
        applicationId: "app-1",
        questionId: "q-1",
        prompt: "Why this internship?",
        text: "I built a Python retrieval pipeline for a machine learning workshop paper.",
      },
      {
        id: "b",
        applicationId: "app-2",
        questionId: "q-2",
        prompt: "Describe a leadership challenge",
        text: "I coordinated volunteers for a campus hackathon.",
      },
    ]);
    expect(ranked[0]?.id).toBe("a");
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });
});
