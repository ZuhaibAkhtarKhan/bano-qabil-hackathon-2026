import { describe, expect, it } from "vitest";

import { groundBatchFillFields } from "../src/index";

const OWNED_EVIDENCE = "11111111-1111-4111-8111-111111111111";
const OWNED_DOC = "22222222-2222-4222-8222-222222222222";
const FOREIGN_EVIDENCE = "33333333-3333-4333-8333-333333333333";
const FOREIGN_DOC = "44444444-4444-4444-8444-444444444444";

describe("batch fill grounding strip", () => {
  it("forces need_you when the LLM cites evidence the user does not own", () => {
    const [field] = groundBatchFillFields({
      allowedEvidenceIds: [OWNED_EVIDENCE],
      allowedDocumentVersionIds: [OWNED_DOC],
      fields: [
        {
          fieldId: "f_name",
          status: "filled",
          value: "Invented fellowship at NASA",
          evidenceIds: [FOREIGN_EVIDENCE],
        },
      ],
    });
    expect(field?.status).toBe("need_you");
    expect(field?.value).toBeUndefined();
    expect(field?.evidenceIds).toBeUndefined();
  });

  it("drops a fabricated documentVersionId and does not fill the file field", () => {
    const [field] = groundBatchFillFields({
      allowedEvidenceIds: [OWNED_EVIDENCE],
      allowedDocumentVersionIds: [OWNED_DOC],
      fields: [
        {
          fieldId: "f_resume",
          status: "filled",
          documentVersionId: FOREIGN_DOC,
        },
      ],
    });
    expect(field?.status).toBe("need_you");
    expect(field?.documentVersionId).toBeUndefined();
  });

  it("keeps a filled value only when a real owned evidence id remains", () => {
    const [field] = groundBatchFillFields({
      allowedEvidenceIds: [OWNED_EVIDENCE],
      allowedDocumentVersionIds: [OWNED_DOC],
      fields: [
        {
          fieldId: "f_name",
          status: "filled",
          value: "Amina Khan",
          evidenceIds: [OWNED_EVIDENCE, FOREIGN_EVIDENCE],
        },
      ],
    });
    expect(field?.status).toBe("filled");
    expect(field?.value).toBe("Amina Khan");
    expect(field?.evidenceIds).toEqual([OWNED_EVIDENCE]);
  });

  it("keeps an owned document version on a file field", () => {
    const [field] = groundBatchFillFields({
      allowedEvidenceIds: [],
      allowedDocumentVersionIds: [OWNED_DOC],
      fields: [
        {
          fieldId: "f_resume",
          status: "filled",
          documentVersionId: OWNED_DOC,
        },
      ],
    });
    expect(field?.status).toBe("filled");
    expect(field?.documentVersionId).toBe(OWNED_DOC);
  });

  it("keeps a required form confirmation without inventing evidence ids", () => {
    const [field] = groundBatchFillFields({
      allowedEvidenceIds: [],
      allowedDocumentVersionIds: [],
      formRequirementFieldIds: ["f_agree"],
      fields: [
        {
          fieldId: "f_agree",
          status: "filled",
          value: "I agree",
        },
      ],
    });
    expect(field?.status).toBe("filled");
    expect(field?.value).toBe("I agree");
  });
});
