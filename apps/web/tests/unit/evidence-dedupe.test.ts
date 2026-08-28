import { describe, expect, it } from "vitest";
import { evidenceIdentityKey, normalizeOrganizationToken } from "@1apply/domain";
import { dedupePlannedEvidence } from "@/server/memory/plan-extraction";

describe("evidenceIdentityKey", () => {
  it("collapses personal org variants", () => {
    const a = evidenceIdentityKey({ kind: "project", title: "MiniJira", organization: "Personal" });
    const b = evidenceIdentityKey({ kind: "project", title: "MiniJira", organization: "Personal Project" });
    const c = evidenceIdentityKey({ kind: "project", title: "MiniJira", organization: null });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("collapses Udemy instructor variants", () => {
    expect(normalizeOrganizationToken("Jonas Schmedtmann (Udemy)")).toBe("udemy");
    expect(normalizeOrganizationToken("Udemy")).toBe("udemy");
    const a = evidenceIdentityKey({
      kind: "certification",
      title: "The Complete JavaScript Course",
      organization: "Udemy",
    });
    const b = evidenceIdentityKey({
      kind: "certification",
      title: "The Complete JavaScript Course",
      organization: "Jonas Schmedtmann (Udemy)",
    });
    expect(a).toBe(b);
  });
});

describe("dedupePlannedEvidence", () => {
  it("keeps a single richest row per identity", () => {
    const rows = dedupePlannedEvidence([
      {
        kind: "project",
        title: "MiniJira",
        organization: null,
        outcome: null,
        skills: [],
      },
      {
        kind: "project",
        title: "MiniJira",
        organization: "Personal Project",
        outcome: "Shipped MVP",
        skills: ["React"],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organization).toBe("Personal Project");
    expect(rows[0]?.outcome).toBe("Shipped MVP");
  });
});
