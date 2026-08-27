import { describe, expect, it } from "vitest";
import { kitFillSchema } from "@/infra/ai/openai";
import { normalizeEvidenceDate, normalizeKitFillRaw } from "@/lib/kit-fill-normalize";

describe("normalizeKitFillRaw", () => {
  it("coerces Gemini object-shaped skills into a string array", () => {
    const raw = {
      profile: { displayName: "Saadia", university: "NUST" },
      skills: { "0": "TypeScript", "1": "React" },
    };
    const parsed = kitFillSchema.safeParse(normalizeKitFillRaw(raw));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.skills).toEqual(["TypeScript", "React"]);
      expect(parsed.data.profile?.displayName).toBe("Saadia");
    }
  });

  it("normalizes resume dates that Postgres rejects", () => {
    expect(normalizeEvidenceDate("Present")).toBeNull();
    expect(normalizeEvidenceDate("Current")).toBeNull();
    expect(normalizeEvidenceDate("Jul 2028")).toBe("2028-07-01");
    expect(normalizeEvidenceDate("July 2024")).toBe("2024-07-01");
    expect(normalizeEvidenceDate("2023")).toBe("2023-01-01");
    expect(normalizeEvidenceDate("2024-06-15")).toBe("2024-06-15");
  });

  it("normalizes evidence dates inside kit fill payloads", () => {
    const raw = {
      evidence: [
        {
          title: "Intern",
          kind: "employment",
          organization: "Acme",
          situation: null,
          action: null,
          outcome: "Built APIs",
          skills: [],
          startDate: "Jun 2023",
          endDate: "Present",
        },
      ],
    };
    const parsed = kitFillSchema.safeParse(normalizeKitFillRaw(raw));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.evidence?.[0]?.startDate).toBe("2023-06-01");
      expect(parsed.data.evidence?.[0]?.endDate).toBeNull();
    }
  });
});
