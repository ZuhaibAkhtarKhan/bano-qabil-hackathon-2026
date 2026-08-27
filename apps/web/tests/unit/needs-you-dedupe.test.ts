import { describe, expect, it } from "vitest";

import {
  dedupeNeedsYouItems,
  normalizeNeedsYouDedupeKey,
  type NeedsYouItem,
} from "@/lib/needs-you";

function item(partial: Partial<NeedsYouItem> & Pick<NeedsYouItem, "id" | "kind" | "title">): NeedsYouItem {
  return {
    applicationId: "app-1",
    applicationHref: "/app/applications/app-1",
    company: "Acme",
    role: "Intern",
    detail: null,
    inputLabel: "Value",
    inputType: "text",
    required: true,
    payload: {},
    ...partial,
  };
}

describe("needs-you question dedupe", () => {
  it("normalizes required chrome and punctuation", () => {
    expect(normalizeNeedsYouDedupeKey("***Required*** Why us?")).toBe("why us");
    expect(normalizeNeedsYouDedupeKey("Why us")).toBe("why us");
  });

  it("keeps one card when answer and field_mapping share a prompt", () => {
    const out = dedupeNeedsYouItems([
      item({
        id: "answer:1",
        kind: "answer",
        title: "Do you currently run your own social media page(s)?",
        inputType: "textarea",
        payload: { questionId: "q1" },
      }),
      item({
        id: "mapping:1",
        kind: "field_mapping",
        title: "Do you currently run your own social media page(s)?",
        inputType: "textarea",
        payload: { mappingId: "m1" },
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("field_mapping");
    expect(out[0]!.payload.mappingId).toBe("m1");
    expect(out[0]!.payload.questionId).toBe("q1");
  });

  it("merges ids when eligibility and mapping share a label", () => {
    const out = dedupeNeedsYouItems([
      item({
        id: "map:1",
        kind: "field_mapping",
        title: "Year of study",
        payload: { mappingId: "m1" },
      }),
      item({
        id: "elig:1",
        kind: "eligibility",
        title: "Year of study *Required*",
        payload: { eligibilityId: "e1", mappingId: "m1" },
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("eligibility");
    expect(out[0]!.payload.mappingId).toBe("m1");
  });

  it("does not collapse different questions", () => {
    const out = dedupeNeedsYouItems([
      item({ id: "a", kind: "answer", title: "Why this program?", inputType: "textarea" }),
      item({ id: "b", kind: "answer", title: "Describe a project", inputType: "textarea" }),
    ]);
    expect(out).toHaveLength(2);
  });
});
