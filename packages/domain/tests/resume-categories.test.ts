import { describe, expect, it } from "vitest";

import { resolveResumeCategory, resumeCategoryDisplayLabel, RESUME_CATEGORY_PRESETS } from "../src/resume-categories";

describe("resume categories", () => {
  it("resolves presets", () => {
    expect(resolveResumeCategory({ preset: "devops" })).toEqual({ key: "devops", label: "DevOps" });
    expect(resolveResumeCategory({ preset: "mern_stack" })).toEqual({ key: "mern_stack", label: "MERN stack" });
    expect(resolveResumeCategory({ preset: "general" })).toEqual({
      key: "general",
      label: "General / all-purpose",
    });
    expect(resolveResumeCategory({ preset: "machine_learning" })).toEqual({
      key: "machine_learning",
      label: "Machine learning / AI",
    });
  });

  it("exposes a full preset list for the upload UI", () => {
    expect(RESUME_CATEGORY_PRESETS.length).toBeGreaterThanOrEqual(15);
    expect(RESUME_CATEGORY_PRESETS.map((item) => item.key)).toEqual(
      expect.arrayContaining(["devops", "mern_stack", "frontend", "data_science", "scholarship"]),
    );
  });

  it("requires a custom label for others", () => {
    expect(resolveResumeCategory({ preset: "other" })).toBeNull();
    expect(resolveResumeCategory({ preset: "other", otherLabel: "  Data Science " })).toEqual({
      key: "other_data_science",
      label: "Data Science",
    });
  });

  it("formats display labels", () => {
    expect(resumeCategoryDisplayLabel("devops")).toBe("DevOps");
    expect(resumeCategoryDisplayLabel("ui_ux")).toBe("UI / UX design");
    expect(resumeCategoryDisplayLabel("other_data_science", "Data Science")).toBe("Data Science");
  });
});
