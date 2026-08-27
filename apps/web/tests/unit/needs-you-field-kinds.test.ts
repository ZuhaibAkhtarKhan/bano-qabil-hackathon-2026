import { describe, expect, it } from "vitest";

import {
  choiceValuesFromMappingOptions,
  formatNeedsYouDocumentOption,
  inputTypeFromHostFieldType,
  isImageUploadRequest,
  joinNeedsYouMultiValues,
  looksLikeYesNoChoiceQuestion,
  normalizeNeedsYouFieldType,
  parseNeedsYouMultiValues,
  persistableFormChoiceOptions,
  resolveNeedsYouChoiceOptions,
} from "@/lib/needs-you-field-kinds";

describe("needs-you field kinds", () => {
  it("detects image upload requests", () => {
    expect(isImageUploadRequest("Upload passport photo")).toBe(true);
    expect(isImageUploadRequest("Resume PDF")).toBe(false);
    expect(isImageUploadRequest("File", "image/png")).toBe(true);
  });

  it("normalizes field types", () => {
    expect(normalizeNeedsYouFieldType("SELECT")).toBe("select");
    expect(normalizeNeedsYouFieldType("file")).toBe("file");
    expect(normalizeNeedsYouFieldType("weird")).toBeNull();
  });

  it("extracts choice values from mapping options", () => {
    expect(choiceValuesFromMappingOptions(["Yes", "No"])).toEqual(["Yes", "No"]);
    expect(choiceValuesFromMappingOptions([{ value: "Onsite" }, { value: "Remote" }])).toEqual([
      "Onsite",
      "Remote",
    ]);
  });

  it("treats commitment Yes/No as select options, not open text", () => {
    const label = "This role needs 4-5 hours a day, part-time. Can you commit to that consistently?";
    expect(looksLikeYesNoChoiceQuestion(label)).toBe(true);
    expect(resolveNeedsYouChoiceOptions({ label, fieldType: "radio" })).toEqual(["Yes", "No"]);
  });

  it("keeps essay prompts as open text even with polluted kit options", () => {
    const label =
      "Do you currently run your own social media page(s), or have you run content/branding for a brand? Share links or examples:";
    expect(looksLikeYesNoChoiceQuestion(label)).toBe(false);
    expect(
      resolveNeedsYouChoiceOptions({
        label,
        fieldType: "textarea",
        mappingOptions: [
          "Software Engineering Student",
          "education — Bachelor of Engineering — GIKI",
          "project — MiniJira — 2026",
          "certification — CS50x",
        ],
      }),
    ).toEqual([]);
    expect(inputTypeFromHostFieldType("textarea", label)).toBe("textarea");
  });

  it("does not turn resume file version ids into select options", () => {
    const options = resolveNeedsYouChoiceOptions({
      label: "Upload your resume/CV:",
      fieldType: "file",
      mappingOptions: [
        { value: "a4dc922a-6973-4c2e-89be-03684460afa6", label: "Resume · cv.pdf" },
        { value: "b5ed033b-7084-5d3f-9acf-14795571bfb7", label: "Design resume · design.pdf" },
      ],
    });
    expect(options).toEqual([]);
  });

  it("only persists real form choices for select/radio fields", () => {
    expect(
      persistableFormChoiceOptions({
        fieldType: "textarea",
        hostOptions: [],
        mappingOptionValues: ["education — Bachelor", "project — MiniJira"],
      }),
    ).toEqual([]);
    expect(
      persistableFormChoiceOptions({
        fieldType: "radio",
        hostOptions: ["Yes", "No"],
        mappingOptionValues: ["education — Bachelor"],
      }),
    ).toEqual(["Yes", "No"]);
  });

  it("formats document options with name, version, and category", () => {
    expect(
      formatNeedsYouDocumentOption({
        label: "Primary resume",
        versionLabel: "v2",
        categoryLabel: "Software Engineering",
        fileName: "zuhaib-resume.pdf",
      }),
    ).toBe("Primary resume · v2 · Software Engineering · zuhaib-resume.pdf");
  });

  it("maps checkbox groups with multiple options to multi-select", () => {
    const label = "Comfortable doing captions/subtitles, sound design, and motion graphics?";
    const options = [
      "Captions / subtitles",
      "Sound design / SFX",
      "Motion graphics / text animation",
      "None of these yet, but willing to learn",
    ];
    expect(inputTypeFromHostFieldType("checkbox", label, options.length)).toBe("multi-select");
    expect(inputTypeFromHostFieldType("multi-select", label, options.length)).toBe("multi-select");
    expect(inputTypeFromHostFieldType("checkbox", "I agree to the terms", 1)).toBe("select");
    expect(
      resolveNeedsYouChoiceOptions({
        label,
        fieldType: "checkbox",
        mappingOptions: options,
      }),
    ).toEqual(options);
  });

  it("round-trips multi-select values with semicolon separators", () => {
    const joined = joinNeedsYouMultiValues(["Captions / subtitles", "Sound design / SFX"]);
    expect(joined).toBe("Captions / subtitles; Sound design / SFX");
    expect(parseNeedsYouMultiValues(joined)).toEqual([
      "Captions / subtitles",
      "Sound design / SFX",
    ]);
  });
});
