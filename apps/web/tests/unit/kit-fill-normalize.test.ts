import { describe, expect, it } from "vitest";
import { kitFillSchema } from "@/infra/ai/openai";
import { normalizeKitFillRaw } from "@/lib/kit-fill-normalize";

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
});
