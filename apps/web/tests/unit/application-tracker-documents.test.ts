import { describe, expect, it } from "vitest";

import {
  buildTrackerRequiredLabels,
  buildTrackerVaultDocs,
  isCoverRequirementLabel,
  trackerDocumentStatuses,
} from "@/lib/application-tracker-documents";

describe("application tracker documents", () => {
  it("detects cover letter requirements from scanned form fields", () => {
    const required = buildTrackerRequiredLabels({
      opportunityDocLabels: [],
      mappingLabels: ["Cover letter", "Email"],
      questionPrompts: [],
    });
    expect(required).toContain("Cover letter");
    expect(isCoverRequirementLabel("Cover letter")).toBe(true);
  });

  it("marks cover letter ready when AI text exists on a form mapping", () => {
    const required = buildTrackerRequiredLabels({
      opportunityDocLabels: [],
      mappingLabels: ["Cover letter"],
      questionPrompts: [],
    });
    const vault = buildTrackerVaultDocs({
      attachedMeta: [],
      mappings: [{ label: "Cover letter", value: "Dear hiring manager...", fieldType: "textarea" }],
      answers: [],
    });
    expect(trackerDocumentStatuses(required, vault)).toEqual({
      resume: "Not required",
      cover: "Ready",
    });
  });

  it("marks cover letter ready when attached as cover_letter document type", () => {
    const required = buildTrackerRequiredLabels({
      opportunityDocLabels: ["Cover letter"],
      mappingLabels: [],
      questionPrompts: [],
    });
    const vault = buildTrackerVaultDocs({
      attachedMeta: [{ label: "Hul Hub cover", type: "cover_letter" }],
      mappings: [],
      answers: [],
    });
    expect(trackerDocumentStatuses(required, vault).cover).toBe("Ready");
  });

  it("marks cover letter missing when required but empty", () => {
    const required = buildTrackerRequiredLabels({
      opportunityDocLabels: [],
      mappingLabels: ["Cover letter"],
      questionPrompts: [],
    });
    const vault = buildTrackerVaultDocs({
      attachedMeta: [],
      mappings: [{ label: "Cover letter", value: "", fieldType: "textarea" }],
      answers: [],
    });
    expect(trackerDocumentStatuses(required, vault).cover).toBe("Missing");
  });

  it("marks cover letter ready from generated application answer text", () => {
    const required = buildTrackerRequiredLabels({
      opportunityDocLabels: [],
      mappingLabels: [],
      questionPrompts: [{ prompt: "Upload your cover letter", required: true }],
    });
    const vault = buildTrackerVaultDocs({
      attachedMeta: [],
      mappings: [],
      answers: [{ prompt: "Upload your cover letter", text: "I am excited to apply..." }],
    });
    expect(trackerDocumentStatuses(required, vault).cover).toBe("Ready");
  });
});
