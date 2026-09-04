import { describe, expect, it } from "vitest";

import {
  dedupeFieldMappings,
  isUserConfirmedFieldMappingSource,
  matchStoredMappingForHostField,
  normalizeMappingIdentity,
} from "@/lib/field-mappings";

describe("field mapping identity", () => {
  it("normalizes Google Forms label noise", () => {
    expect(normalizeMappingIdentity("Email *")).toBe("email");
    expect(normalizeMappingIdentity("Comments CommentsYour answer")).toBe("comments");
    expect(normalizeMappingIdentity("Phone number")).toBe("phone number");
  });

  it("collapses Email * and Email into one autofill row", () => {
    const rows = dedupeFieldMappings([
      {
        id: "1",
        field_key: "email_star",
        label: "Email *",
        value: "zuhaib@example.com",
        source: "Application Memory",
        confidence: 0.99,
      },
      {
        id: "2",
        field_key: "email_kit",
        label: "Email",
        value: "zuhaib@example.com",
        source: "Your kit refresh - Application Memory",
        confidence: 0.99,
      },
      {
        id: "3",
        field_key: "comments_empty",
        label: "Comments",
        value: "",
        source: "AI draft",
        confidence: 0.4,
        excluded_by_default: true,
      },
      {
        id: "4",
        field_key: "comments_filled",
        label: "Comments CommentsYour answer",
        value: "hihi",
        source: "Needs You (this application only)",
        confidence: 1,
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => normalizeMappingIdentity(String(row.label)))).toEqual(
      expect.arrayContaining(["email", "comments"]),
    );
    expect(rows.find((row) => normalizeMappingIdentity(String(row.label)) === "comments")?.value).toBe(
      "hihi",
    );
  });

  it("matches host Email to stored Email * mapping", () => {
    const stored = [
      {
        id: "1",
        field_key: "email_star",
        label: "Email *",
        value: "zuhaib@example.com",
        source: "Application Memory",
        confidence: 0.99,
      },
    ];
    const match = matchStoredMappingForHostField(stored, {
      fieldKey: "f_abc",
      fieldId: "f_abc",
      label: "Email",
    });
    expect(match?.value).toBe("zuhaib@example.com");
  });

  it("keeps a filled Need You answer over an empty recapture of the same question", () => {
    const rows = dedupeFieldMappings([
      {
        id: "empty",
        field_key: "f_new_session",
        label: "Are you authorized to work in the United States?",
        value: "",
        source: "page_capture",
        confidence: 0.1,
        excluded_by_default: true,
      },
      {
        id: "filled",
        field_key: "are_you_authorized_to_work_in_the_united_states",
        label: "Are you authorized to work in the United States?",
        value: "Yes",
        source: "Needs You (this application only)",
        confidence: 1,
        excluded_by_default: false,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("filled");
    expect(rows[0]?.value).toBe("Yes");
  });
});

describe("isUserConfirmedFieldMappingSource", () => {
  it("protects Need You and per-application answers from kit wipe", () => {
    expect(isUserConfirmedFieldMappingSource("Needs You (this application only)")).toBe(true);
    expect(isUserConfirmedFieldMappingSource("Application Memory (Needs You)")).toBe(true);
    expect(isUserConfirmedFieldMappingSource("batch_fill")).toBe(false);
    expect(isUserConfirmedFieldMappingSource("Your kit refresh - Application Memory")).toBe(false);
  });
});
