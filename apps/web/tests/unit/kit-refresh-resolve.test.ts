import { describe, expect, it } from "vitest";

import type { MemoryValue } from "@1apply/form-engine";

import { resolveKitValueForLabel } from "@/server/applications/refresh-from-kit";

const catalog: MemoryValue[] = [
  {
    path: "Profile → Phone",
    source: "Application Memory",
    value: "+92346591486",
    aliases: ["phone", "mobile", "whatsapp", "telephone", "contact"],
  },
  {
    path: "Profile → Location",
    source: "Application Memory",
    value: "Topi, Pakistan",
    aliases: ["location", "city", "country"],
  },
  {
    path: "Profile → Full name",
    source: "Application Memory",
    value: "Zuhaib Akhtar",
    aliases: ["name", "full name"],
  },
];

describe("resolveKitValueForLabel", () => {
  it("fills contact/phone questions from kit phone", () => {
    expect(resolveKitValueForLabel("Contact No.", catalog)?.value).toBe("+92346591486");
    expect(resolveKitValueForLabel("Contact number", catalog)?.value).toBe("+92346591486");
  });

  it("fills place/location questions from kit location", () => {
    expect(resolveKitValueForLabel("Your Place ?", catalog)?.value).toBe("Topi, Pakistan");
    expect(resolveKitValueForLabel("The applicant's current place of residence or location.", catalog)?.value).toBe(
      "Topi, Pakistan",
    );
  });

  it("fills uni/university from education catalog", () => {
    const withEdu: MemoryValue[] = [
      ...catalog,
      {
        path: "Education → Institution",
        source: "Your kit",
        value: "GIKI",
        aliases: ["university", "uni", "college"],
      },
    ];
    expect(resolveKitValueForLabel("Uni", withEdu)?.value).toBe("GIKI");
    expect(resolveKitValueForLabel("University", withEdu)?.value).toBe("GIKI");
  });

  it("ignores fit-index noise facts", () => {
    expect(resolveKitValueForLabel("No verified evidence found in Application Memory.", catalog)).toBeNull();
  });
});
