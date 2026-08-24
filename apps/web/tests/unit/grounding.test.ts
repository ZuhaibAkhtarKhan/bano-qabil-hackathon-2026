import { describe, expect, it } from "vitest";

import { finalizeGroundedDraft, freezeSubmissionManifest, lengthWarnings } from "@1apply/domain";

const allowed = ["11111111-1111-4111-8111-111111111111"];

describe("finalizeGroundedDraft", () => {
  it("refuses fluent text that cites no allowed evidence", () => {
    const draft = finalizeGroundedDraft({
      text: "I led a published research lab at CERN.",
      citedIds: [],
      allowedIds: allowed,
    });
    expect(draft.text).toBe("");
    expect(draft.warnings).toContain("NO_EVIDENCE");
    expect(draft.characterCount).toBe(0);
  });

  it("strips unknown evidence ids instead of trusting the model", () => {
    const draft = finalizeGroundedDraft({
      text: "I built a retrieval pipeline for my thesis.",
      citedIds: ["99999999-9999-4999-8999-999999999999", allowed[0]!],
      allowedIds: allowed,
    });
    expect(draft.evidenceIds).toEqual(allowed);
    expect(draft.warnings).toContain("UNKNOWN_EVIDENCE_STRIPPED");
    expect(draft.text).toContain("retrieval pipeline");
  });
});

describe("lengthWarnings", () => {
  it("flags over-limit drafts without silently truncating them", () => {
    expect(lengthWarnings("one two three four", 3, "words")).toEqual(["LENGTH_EXCEEDED"]);
    expect(lengthWarnings("short", 10, "characters")).toEqual([]);
  });
});

describe("freezeSubmissionManifest", () => {
  it("copies answer text and document ids so later edits cannot mutate the snapshot", () => {
    const answers = [{ questionId: "q1", answerVersionId: "a1", prompt: "Why?", text: "I trained a model at NED." }];
    const documents = [{ documentId: "d1", documentVersionId: "v1", label: "AI resume" }];
    const snapshot = freezeSubmissionManifest({ answers, documents });
    answers[0]!.answerVersionId = "changed";
    answers[0]!.text = "changed";
    documents[0]!.documentVersionId = "changed";
    expect(snapshot.answerManifest[0]?.answerVersionId).toBe("a1");
    expect(snapshot.answerManifest[0]?.text).toBe("I trained a model at NED.");
    expect(snapshot.documentManifest[0]?.documentVersionId).toBe("v1");
  });
});
