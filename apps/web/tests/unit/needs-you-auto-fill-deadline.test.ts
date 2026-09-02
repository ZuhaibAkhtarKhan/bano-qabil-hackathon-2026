import { describe, expect, it } from "vitest";

import type { NeedsYouItem } from "@/lib/needs-you";
import { isAutoFillableNeedsYouTextItem } from "@/server/needs-you/auto-fill-deadline";

function item(partial: Partial<NeedsYouItem>): NeedsYouItem {
  return {
    id: "test",
    kind: "field_mapping",
    applicationId: "app-1",
    applicationHref: "/app/applications/app-1",
    company: "Co",
    role: "Role",
    title: "Why do you want this role?",
    detail: null,
    inputLabel: "Your answer",
    inputType: "textarea",
    required: true,
    payload: {},
    ...partial,
  };
}

describe("isAutoFillableNeedsYouTextItem", () => {
  it("includes empty text field mappings", () => {
    expect(isAutoFillableNeedsYouTextItem(item({ inputType: "textarea" }))).toBe(true);
  });

  it("skips selects and uploads", () => {
    expect(isAutoFillableNeedsYouTextItem(item({ inputType: "select" }))).toBe(false);
    expect(isAutoFillableNeedsYouTextItem(item({ inputType: "document", kind: "document" }))).toBe(false);
  });

  it("skips confirm-only eligibility", () => {
    expect(
      isAutoFillableNeedsYouTextItem(
        item({ kind: "eligibility", payload: { confirmEligible: true } }),
      ),
    ).toBe(false);
  });

  it("skips fields that already have a value", () => {
    expect(
      isAutoFillableNeedsYouTextItem(item({ payload: { currentValue: "Already filled" } })),
    ).toBe(false);
  });
});
