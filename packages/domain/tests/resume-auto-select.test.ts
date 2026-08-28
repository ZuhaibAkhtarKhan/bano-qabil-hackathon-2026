import { describe, expect, it } from "vitest";

import { buildAutoResumeSelection, inferOpportunityCategoryKeys } from "../src/resume-auto-select";

describe("resume auto-select", () => {
  it("infers machine learning from posting text", () => {
    const inferred = inferOpportunityCategoryKeys("Senior Machine Learning Engineer Python PyTorch");
    expect(inferred[0]?.key).toBe("machine_learning");
  });

  it("picks the resume in the matching category (latest version id)", () => {
    const selection = buildAutoResumeSelection("Backend software engineer API Node.js", [
      {
        documentId: "web-doc",
        documentVersionId: "web-v3",
        label: "Frontend",
        type: "resume",
        categoryKey: "frontend",
        categoryLabel: "Frontend",
        text: "React CSS",
      },
      {
        documentId: "be-doc",
        documentVersionId: "be-v2",
        label: "Backend",
        type: "resume",
        categoryKey: "backend",
        categoryLabel: "Backend",
        text: "Node API PostgreSQL",
      },
    ]);

    expect(selection.strategy).toBe("category_match");
    expect(selection.ranked.find((item) => item.recommended)?.documentId).toBe("be-doc");
    expect(selection.ranked.find((item) => item.recommended)?.documentVersionId).toBe("be-v2");
    expect(selection.notifyUser).toBe(false);
  });

  it("falls back to AI rank and notifies when no category matches", () => {
    const selection = buildAutoResumeSelection("Machine learning research fellowship NLP", [
      {
        documentId: "general-doc",
        documentVersionId: "general-v1",
        label: "General",
        type: "resume",
        categoryKey: "general",
        categoryLabel: "General / all-purpose",
        text: "General resume",
      },
      {
        documentId: "web-doc",
        documentVersionId: "web-v1",
        label: "Web",
        type: "resume",
        categoryKey: "frontend",
        categoryLabel: "Frontend",
        text: "React frontend",
      },
    ]);

    expect(selection.strategy).toBe("ai_rank");
    expect(selection.notifyUser).toBe(true);
    expect(selection.notificationBody).toMatch(/1-Apply selected/i);
  });
});
