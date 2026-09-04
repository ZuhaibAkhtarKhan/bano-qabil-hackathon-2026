import { describe, expect, it } from "vitest";

import {
  mappingBlocksPageAdvance,
  requiredHostFieldsMissing,
} from "@/server/applications/host-page-fill";

describe("requiredHostFieldsMissing", () => {
  it("ignores optional gaps and reports required fields without a fill plan value", () => {
    const missing = requiredHostFieldsMissing(
      [
        { fieldId: "a", required: true, label: "Full name" },
        { fieldId: "b", required: false, label: "Are you authorized to work in the United States?" },
        { fieldId: "c", required: true, label: "Email" },
      ],
      [
        { fieldId: "a", status: "filled", value: "Ada Lovelace" },
        { fieldId: "b", status: "need_you", value: "" },
        { fieldId: "c", status: "need_you", value: "" },
      ],
    );
    expect(missing).toEqual(["Email"]);
  });

  it("treats document version ids as filled", () => {
    const missing = requiredHostFieldsMissing(
      [{ fieldId: "resume", required: true, label: "Resume" }],
      [{ fieldId: "resume", status: "filled", documentVersionId: "11111111-1111-4111-8111-111111111111" }],
    );
    expect(missing).toEqual([]);
  });
});

describe("mappingBlocksPageAdvance", () => {
  it("never blocks optional host fields", () => {
    expect(
      mappingBlocksPageAdvance({
        value: "",
        confidence: 0.1,
        excluded_by_default: true,
        meta: { required: false },
      }),
    ).toBe(false);
  });

  it("blocks unanswered required fields", () => {
    expect(
      mappingBlocksPageAdvance({
        value: "",
        confidence: 0.2,
        excluded_by_default: true,
        meta: { required: true },
      }),
    ).toBe(true);
  });

  it("does not block a filled Need You answer", () => {
    expect(
      mappingBlocksPageAdvance({
        value: "Yes",
        confidence: 1,
        excluded_by_default: false,
        meta: { required: true },
      }),
    ).toBe(false);
  });
});
