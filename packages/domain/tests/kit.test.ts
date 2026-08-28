import { describe, expect, it } from "vitest";

import {
  classifyPendingPacket,
  classifyRequiredDocumentLabel,
  CNIC_PHARM_B_LABEL,
  kitStatus,
  matchVaultDocument,
  packetAnswerText,
  packetSummary,
  planKitAttachments,
  requiredDocumentCovered,
} from "../src/kit";

const vault = [
  { id: "r1", type: "resume", label: "Primary resume", currentVersionId: "v1" },
  { id: "cnic", type: "identity_document", label: "CNIC", currentVersionId: "v2" },
  { id: "bform", type: "family_document", label: "B-form", currentVersionId: "v3" },
  { id: "tr", type: "transcript", label: "Official transcript", currentVersionId: "v4" },
];

describe("kit document matching", () => {
  it("classifies CNIC, B-form, and resume labels", () => {
    expect(classifyRequiredDocumentLabel("Copy of CNIC")).toBe("identity_document");
    expect(classifyRequiredDocumentLabel("B-Form of applicant")).toBe("family_document");
    expect(classifyRequiredDocumentLabel("Updated CV")).toBe("resume");
    expect(classifyRequiredDocumentLabel("Official transcript")).toBe("transcript");
  });

  it("matches custom-named other kit documents to application labels", () => {
    const customVault = [
      ...vault,
      { id: "mot", type: "other", label: "Motivation letter", currentVersionId: "v5" },
    ];
    expect(requiredDocumentCovered("Motivation letter", [{ type: "other", label: "Motivation letter" }])).toBe(true);
    expect(matchVaultDocument("Motivation letter", customVault)?.id).toBe("mot");
    expect(requiredDocumentCovered("motivation letter", [{ type: "other", label: "Motivation letter" }])).toBe(true);
  });

  it("matches vault files to posting labels without requiring identical names", () => {
    expect(matchVaultDocument("National Identity Card (CNIC)", vault)?.id).toBe("cnic");
    expect(matchVaultDocument("B form", vault)?.id).toBe("bform");
    expect(matchVaultDocument("Resume / CV", vault)?.id).toBe("r1");
  });

  it("covers required docs by kind, not exact label", () => {
    expect(requiredDocumentCovered("Copy of CNIC", [{ type: "identity_document", label: "CNIC" }])).toBe(true);
    expect(requiredDocumentCovered("Copy of CNIC", [{ type: "resume", label: "Primary resume" }])).toBe(false);
  });

  it("attaches each vault file at most once", () => {
    const plan = planKitAttachments(
      [
        { label: "CNIC", required: true },
        { label: "National ID card", required: true },
        { label: "CV", required: true },
      ],
      vault,
      new Set(),
    );
    expect(plan.map((item) => item.document.id).sort()).toEqual(["cnic", "r1"]);
  });
});

describe("packet text and lanes", () => {
  it("treats suggestions as packet text until the user edits", () => {
    expect(
      packetAnswerText({
        approvedText: null,
        userEditedText: null,
        originalAiText: "I studied CS at NUST.",
      }),
    ).toBe("I studied CS at NUST.");
  });

  it("sends a complete opt-in packet to the deadline lane", () => {
    expect(
      classifyPendingPacket({
        status: "in_progress",
        deadlineAt: "2026-09-01T00:00:00.000Z",
        hasCaptcha: false,
        hasSignature: false,
        hasPayment: false,
        identityPresent: true,
        missingRequiredDocuments: [],
        questionsWithoutPacketText: 0,
        suggestionCount: 2,
        prepareAndSendIfSilent: true,
      }),
    ).toBe("sends_at_deadline");
  });

  it("pauses on CAPTCHA instead of auto-sending", () => {
    expect(
      classifyPendingPacket({
        status: "in_progress",
        deadlineAt: "2026-09-01T00:00:00.000Z",
        hasCaptcha: true,
        hasSignature: false,
        hasPayment: false,
        identityPresent: true,
        missingRequiredDocuments: [],
        questionsWithoutPacketText: 0,
        suggestionCount: 0,
        prepareAndSendIfSilent: true,
      }),
    ).toBe("waiting_host");
  });

  it("asks the user when identity or documents are missing", () => {
    expect(
      classifyPendingPacket({
        status: "in_progress",
        deadlineAt: "2026-09-01T00:00:00.000Z",
        hasCaptcha: false,
        hasSignature: false,
        hasPayment: false,
        identityPresent: false,
        missingRequiredDocuments: ["CNIC"],
        questionsWithoutPacketText: 1,
        suggestionCount: 0,
        prepareAndSendIfSilent: true,
      }),
    ).toBe("needs_you");
  });

  it("summarizes the packet without inventing contents", () => {
    expect(
      packetSummary({
        attachedCount: 2,
        requiredCount: 3,
        questionCount: 4,
        packetAnswerCount: 3,
        suggestionCount: 2,
      }),
    ).toMatch(/2\/3 required documents/);
  });
});

describe("kit status", () => {
  it("is ready when name and resume exist; identity docs stay visible gaps", () => {
    const status = kitStatus({
      displayName: "Saadia",
      university: "NUST",
      educationSummary: "BS Computer Science",
      documents: vault,
    });
    expect(status.ready).toBe(true);
    expect(status.hasIdentityDocument).toBe(true);
    expect(status.missing).toEqual([]);
  });

  it("lists skipped kit facts and files so login can remind the user", () => {
    const status = kitStatus({
      displayName: "Saadia",
      university: "",
      educationSummary: "",
      documents: [{ id: "r1", type: "resume", label: "CV", currentVersionId: "v1" }],
    });
    expect(status.ready).toBe(true);
    expect(status.missing).toEqual(["university", "education", CNIC_PHARM_B_LABEL]);
  });
});
