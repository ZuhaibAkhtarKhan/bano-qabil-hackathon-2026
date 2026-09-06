import { describe, expect, it } from "vitest";

import {
  isHostFileUploadEntry,
  mappingBlocksHostPageContinue,
  mappingBlocksPageAdvance,
  mappingFromHostFormPage,
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

describe("isHostFileUploadEntry", () => {
  it("treats Need You prose on a misclassified file field as text to type", () => {
    expect(
      isHostFileUploadEntry({
        type: "file",
        value: "I built a portfolio at example.com",
      }),
    ).toBe(false);
  });

  it("still treats document version ids as uploads", () => {
    expect(
      isHostFileUploadEntry({
        type: "file",
        value: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe(true);
    expect(
      isHostFileUploadEntry({
        type: "text",
        documentVersionId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe(true);
  });
});

describe("mappingBlocksPageAdvance", () => {
  it("blocks unanswered optional host fields until filled or skipped", () => {
    expect(
      mappingBlocksPageAdvance({
        value: "",
        confidence: 0.1,
        excluded_by_default: true,
        meta: { required: false },
      }),
    ).toBe(true);
  });

  it("does not block optional fields the applicant skipped", () => {
    expect(
      mappingBlocksPageAdvance({
        value: "",
        confidence: 1,
        excluded_by_default: false,
        meta: { required: false, skipped: true },
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

describe("mappingBlocksHostPageContinue", () => {
  it("ignores kit-only empties that were never on a host page", () => {
    expect(
      mappingFromHostFormPage({
        label: "Preferred name",
        field_key: "preferred_name",
        source: "Your kit",
        meta: {},
      }),
    ).toBe(false);
    expect(
      mappingBlocksHostPageContinue({
        label: "Preferred name",
        field_key: "preferred_name",
        value: "",
        confidence: 0.1,
        excluded_by_default: true,
        source: "Your kit",
        meta: {},
      }),
    ).toBe(false);
  });

  it("blocks unanswered host-page fields from page capture / Need You", () => {
    expect(
      mappingBlocksHostPageContinue({
        label: "Full name",
        field_key: "full_name",
        value: "",
        confidence: 0.2,
        excluded_by_default: true,
        source: "page_capture",
        meta: { required: true },
      }),
    ).toBe(true);
  });

  it("does not treat form-builder chrome as a page-continue blocker", () => {
    expect(
      mappingBlocksHostPageContinue({
        label: "Add option",
        field_key: "add_option",
        value: "",
        confidence: 0,
        excluded_by_default: true,
        source: "page_capture",
        meta: { required: false },
      }),
    ).toBe(false);
  });
});
