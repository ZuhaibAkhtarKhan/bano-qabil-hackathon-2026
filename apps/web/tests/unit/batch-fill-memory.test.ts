import { describe, expect, it } from "vitest";

import type { FieldMapping } from "@1apply/form-engine";

import {
  attachCatalogCitations,
  citeMatchingCatalogIds,
  fillCustomQuestionsFromMemory,
  isHostFilledValue,
  keepAlreadyFilledFields,
  mappingsToBatchResults,
  preferFilledResults,
  sanitizeNativeFieldValues,
  storedMappingToFillResult,
  type GroundingCatalog,
} from "@/server/extension/batch-fill";

const DOC = "22222222-2222-4222-8222-222222222222";

function catalog(overrides: Partial<GroundingCatalog> = {}): GroundingCatalog {
  const kit = [
    { id: "kit:Profile → Full name", path: "Profile → Full name", value: "Amina Khan" },
    { id: "kit:Profile → Email", path: "Profile → Email", value: "amina@example.com" },
    { id: "kit:Need You → University", path: "Need You → University", value: "GIKI" },
  ];
  return {
    allowedEvidenceIds: kit.map((item) => item.id),
    allowedDocumentVersionIds: [DOC],
    evidence: [],
    kit,
    documents: [
      {
        documentVersionId: DOC,
        documentId: "doc-1",
        label: "Master resume",
        type: "resume",
        filename: "Amina_Khan_Resume.pdf",
      },
    ],
    ...overrides,
  };
}

function mapping(partial: Partial<FieldMapping> & Pick<FieldMapping, "fieldKey" | "memoryPath" | "proposedValue">): FieldMapping {
  return {
    label: partial.fieldKey,
    source: "Application Memory",
    confidence: 0.9,
    options: [],
    approvalState: "pending",
    sensitive: false,
    excludedByDefault: false,
    reason: "test",
    fieldType: "text",
    aiAnswerable: false,
    showChip: false,
    ...partial,
  };
}

describe("batch fill uses Application Memory instead of uncited LLM output", () => {
  it("cites kit and Need You values that appear in the filled text", () => {
    const ids = citeMatchingCatalogIds("Amina Khan from GIKI", catalog());
    expect(ids).toContain("kit:Profile → Full name");
    expect(ids).toContain("kit:Need You → University");
  });

  it("does not let an empty LLM row overwrite a kit-filled field", () => {
    const merged = preferFilledResults(
      [{ fieldId: "f_name", status: "filled", value: "Amina Khan", evidenceIds: ["kit:Profile → Full name"] }],
      [{ fieldId: "f_name", status: "need_you" }],
    );
    expect(merged[0]?.status).toBe("filled");
    expect(merged[0]?.value).toBe("Amina Khan");
  });

  it("keeps LLM text only after catalog ids can be attached", () => {
    const cited = attachCatalogCitations(
      [{ fieldId: "f_email", status: "filled", value: "amina@example.com" }],
      catalog(),
    );
    expect(cited[0]?.status).toBe("filled");
    expect(cited[0]?.evidenceIds).toContain("kit:Profile → Email");

    const stripped = attachCatalogCitations(
      [{ fieldId: "f_essay", status: "filled", value: "I invented a NASA fellowship" }],
      catalog(),
    );
    expect(stripped[0]?.status).toBe("need_you");
    expect(stripped[0]?.value).toBeUndefined();
  });

  it("maps name/email from memory and resume from the vault", () => {
    const { results, formRequirementFieldIds } = mappingsToBatchResults(
      [
        { fieldId: "f_name", type: "text", label: "Full name" },
        { fieldId: "f_email", type: "text", label: "Email" },
        { fieldId: "f_resume", type: "file", label: "Upload resume" },
        { fieldId: "f_agree", type: "checkbox", label: "Record my email", options: ["Yes"] },
      ],
      [
        mapping({ fieldKey: "f_name", memoryPath: "Profile → Full name", proposedValue: "Amina Khan" }),
        mapping({ fieldKey: "f_email", memoryPath: "Profile → Email", proposedValue: "amina@example.com" }),
        mapping({
          fieldKey: "f_resume",
          memoryPath: "Documents → Resume",
          proposedValue: DOC,
          fieldType: "file",
          attachment: {
            documentId: "doc-1",
            versionId: DOC,
            filename: "Amina_Khan_Resume.pdf",
            mimeType: "application/pdf",
            byteSize: 12,
          },
        }),
        mapping({
          fieldKey: "f_agree",
          memoryPath: "Required confirmation",
          proposedValue: "Yes",
          fieldType: "checkbox",
        }),
      ],
      catalog(),
    );

    expect(results.find((item) => item.fieldId === "f_name")).toMatchObject({
      status: "filled",
      value: "Amina Khan",
    });
    expect(results.find((item) => item.fieldId === "f_email")?.status).toBe("filled");
    expect(results.find((item) => item.fieldId === "f_resume")).toMatchObject({
      status: "filled",
      documentVersionId: DOC,
    });
    expect(results.find((item) => item.fieldId === "f_agree")?.status).toBe("filled");
    expect(formRequirementFieldIds).toContain("f_agree");
  });

  it("still attaches a resume when the host label is generic upload", () => {
    const { results } = mappingsToBatchResults(
      [{ fieldId: "f_file", type: "file", label: "Attach file" }],
      [mapping({ fieldKey: "f_file", memoryPath: "Documents → Resume", proposedValue: "", fieldType: "file" })],
      catalog(),
    );
    expect(results[0]).toMatchObject({ status: "filled", documentVersionId: DOC });
  });

  it("turns a Need You document UUID into a file fill, not a typed text value", () => {
    expect(
      storedMappingToFillResult({
        fieldId: "f_resume",
        fieldType: "file",
        value: DOC,
        source: "Needs You document",
        allowedDocumentVersionIds: [DOC],
      }),
    ).toMatchObject({ status: "filled", documentVersionId: DOC });
    expect(
      storedMappingToFillResult({
        fieldId: "f_name",
        fieldType: "text",
        value: "Amina Khan",
        source: "Needs You",
      }),
    ).toMatchObject({ status: "filled", value: "Amina Khan" });
  });

  it("fills radio and checkbox choices from Application Memory even when the option text is short", () => {
    const { results, formRequirementFieldIds } = mappingsToBatchResults(
      [
        { fieldId: "f_year", type: "radio", label: "Year of study", options: ["1st", "2nd", "3rd", "4th"] },
        { fieldId: "f_track", type: "select", label: "Track", options: ["Engineering", "Design"] },
        { fieldId: "f_agree", type: "checkbox", label: "I agree", options: ["Yes"] },
      ],
      [
        mapping({
          fieldKey: "f_year",
          memoryPath: "Education → Year of study",
          proposedValue: "3rd",
          fieldType: "radio",
        }),
        mapping({
          fieldKey: "f_track",
          memoryPath: "Application Memory",
          proposedValue: "Engineering",
          fieldType: "select",
        }),
        mapping({
          fieldKey: "f_agree",
          memoryPath: "Required confirmation",
          proposedValue: "Yes",
          fieldType: "checkbox",
        }),
      ],
      catalog(),
    );
    expect(results.find((item) => item.fieldId === "f_year")).toMatchObject({ status: "filled", value: "3rd" });
    expect(results.find((item) => item.fieldId === "f_track")).toMatchObject({ status: "filled", value: "Engineering" });
    expect(results.find((item) => item.fieldId === "f_agree")?.status).toBe("filled");
    expect(formRequirementFieldIds).toEqual(expect.arrayContaining(["f_year", "f_track", "f_agree"]));
  });

  it("does not treat an unselected radio as already filled", () => {
    const { results, alreadyFilledFieldIds } = keepAlreadyFilledFields([
      { fieldId: "f_year", type: "radio", label: "Year", currentValue: "1st 2nd 3rd 4th" },
      { fieldId: "f_why", type: "textarea", label: "Why us?", currentValue: "Because of the mission." },
    ]);
    expect(alreadyFilledFieldIds).toEqual(["f_why"]);
    expect(results.find((item) => item.fieldId === "f_year")?.status).toBe("need_you");
  });

  it("keeps host answers that are already filled and does not treat placeholders as filled", () => {
    expect(isHostFilledValue("Your answer")).toBe(false);
    expect(isHostFilledValue("I already wrote this essay")).toBe(true);
    const { results, alreadyFilledFieldIds } = keepAlreadyFilledFields([
      { fieldId: "f_why", type: "textarea", label: "Why us?", currentValue: "Because of the mission." },
      { fieldId: "f_empty", type: "text", label: "Name", currentValue: "Your answer" },
    ]);
    expect(alreadyFilledFieldIds).toEqual(["f_why"]);
    expect(results.find((item) => item.fieldId === "f_why")?.status).toBe("filled");
    expect(results.find((item) => item.fieldId === "f_empty")?.status).toBe("need_you");
  });

  it("fills a custom question from a saved Application Memory / Need You answer", () => {
    const memory = catalog({
      allowedEvidenceIds: [
        "kit:Profile → Full name",
        "kit:Profile → Email",
        "kit:Need You → University",
        "kit:Answer → Why do you want to join",
      ],
      kit: [
        { id: "kit:Profile → Full name", path: "Profile → Full name", value: "Amina Khan" },
        { id: "kit:Answer → Why do you want to join", path: "Answer → Why do you want to join", value: "I want to join because GIKI taught me retrieval systems." },
      ],
    });
    const results = fillCustomQuestionsFromMemory(
      [{ fieldId: "f_why", type: "textarea", label: "Why do you want to join this program?" }],
      [
        mapping({
          fieldKey: "f_why",
          memoryPath: "Approved Application Answer",
          proposedValue: "",
          aiAnswerable: true,
          options: [{ value: "I want to join because GIKI taught me retrieval systems.", label: "Answer → Why do you want to join", source: "Approved answer" }],
        }),
      ],
      memory,
    );
    expect(results[0]?.status).toBe("filled");
    expect(results[0]?.value).toMatch(/retrieval/i);
  });

  it("does not overwrite an already-filled custom question with kit mapping", () => {
    const merged = preferFilledResults(
      [{ fieldId: "f_why", status: "filled", value: "Host already answered." }],
      [{ fieldId: "f_why", status: "filled", value: "Kit overwrite", evidenceIds: ["kit:Answer → Why"] }],
    );
    expect(merged[0]?.value).toBe("Host already answered.");
  });

  it("does not fill date inputs with availability text or AI essays", () => {
    const memory = catalog({
      allowedEvidenceIds: ["kit:Profile → Availability"],
      kit: [{ id: "kit:Profile → Availability", path: "Profile → Availability", value: "Mon-Friday" }],
    });
    const fromKit = mappingsToBatchResults(
      [{ fieldId: "f_start", type: "date", label: "Start date" }],
      [mapping({ fieldKey: "f_start", memoryPath: "Profile → Availability", proposedValue: "Mon-Friday", fieldType: "date" })],
      memory,
    );
    expect(fromKit.results[0]?.status).toBe("need_you");

    const sanitized = sanitizeNativeFieldValues(
      [
        { fieldId: "f_start", type: "date", label: "Start date" },
        { fieldId: "f_end", type: "date", label: "End date" },
      ],
      [
        { fieldId: "f_start", status: "filled", value: "Mon-Friday", evidenceIds: ["kit:Profile → Availability"] },
        {
          fieldId: "f_end",
          status: "filled",
          value:
            "I do not have specific information regarding an end date for my current or previous positions, as my application memory does not include details about my employment history.",
          evidenceIds: ["kit:Profile → Availability"],
        },
      ],
    );
    expect(sanitized.every((item) => item.status === "need_you")).toBe(true);

    const iso = sanitizeNativeFieldValues(
      [{ fieldId: "f_start", type: "date", label: "Start date" }],
      [{ fieldId: "f_start", status: "filled", value: "2024-09-01", evidenceIds: ["kit:Profile → Availability"] }],
    );
    expect(iso[0]).toMatchObject({ status: "filled", value: "2024-09-01" });
  });
});
