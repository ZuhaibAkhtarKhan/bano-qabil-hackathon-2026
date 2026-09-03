import { describe, expect, it } from "vitest";

import { finalizeGroundedDraft, freezeSubmissionManifest, groundBatchFillFields, lengthWarnings } from "@1apply/domain";

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

describe("groundBatchFillFields", () => {
  it("keeps profile memory fills without evidence citations", () => {
    const grounded = groundBatchFillFields({
      fields: [
        {
          fieldId: "f_name",
          status: "filled",
          value: "Zuhaib Akhtar",
          applyMode: "auto",
        },
      ],
      allowedEvidenceIds: [],
      allowedDocumentVersionIds: [],
    });
    expect(grounded[0]?.status).toBe("filled");
    expect(grounded[0]?.value).toBe("Zuhaib Akhtar");
  });

  it("downgrades AI assistant fields with no grounding to need_you", () => {
    const grounded = groundBatchFillFields({
      fields: [
        {
          fieldId: "f_essay",
          status: "filled",
          value: "I am passionate about software engineering.",
          applyMode: "ai_assistant",
        },
      ],
      allowedEvidenceIds: [],
      allowedDocumentVersionIds: [],
    });
    expect(grounded[0]?.status).toBe("need_you");
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
