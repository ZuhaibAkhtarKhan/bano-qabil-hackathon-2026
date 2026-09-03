import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { assertOwnedMemory, memoryFactKey } from "@1apply/domain";
import { evidenceSemanticStatus, factSemanticStatus } from "@/lib/status";
import { planDocumentExtraction } from "@/server/memory/plan-extraction";

const migration = readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20260818040000_memory.sql"),
  "utf8",
);

describe("planDocumentExtraction", () => {
  it("marks extracted evidence as unverified with source keys", () => {
    const plan = planDocumentExtraction(
      {
        displayName: "Ada Lovelace",
        headline: "Engineer",
        evidence: [
          {
            title: "B.S. Computer Science",
            kind: "education",
            organization: "MIT",
            situation: null,
            action: null,
            outcome: null,
            skills: [],
            endDate: "2027-06-01",
            excerpt: "Expected graduation 2027",
          },
        ],
      },
      [],
    );

    expect(plan.evidence[0]?.verificationStatus).toBe("unverified");
    expect(plan.evidence[0]?.extractionStatus).toBe("extracted");
    expect(plan.evidence[0]?.factKey).toContain("title");
    const gradFact = plan.facts.find((fact) => fact.value.includes("2027"));
    expect(gradFact).toBeDefined();
    expect(gradFact!.factKey).toContain("end-year");
  });

  it("detects graduation conflicts across existing and planned facts", () => {
    const factKey = memoryFactKey({
      category: "education",
      organization: "MIT",
      title: "B.S. Computer Science",
      field: "end_year",
    });
    const plan = planDocumentExtraction(
      {
        displayName: null,
        headline: null,
        evidence: [
          {
            title: "B.S. Computer Science",
            kind: "education",
            organization: "MIT",
            situation: null,
            action: null,
            outcome: null,
            skills: [],
            endDate: "2028-06-01",
          },
        ],
      },
      [
        {
          id: "existing",
          userId: "user-1",
          factKey,
          category: "education",
          value: "2027-06-01",
          verificationStatus: "unverified",
        },
      ],
    );

    expect(plan.conflicts.length).toBeGreaterThan(0);
  });
});

describe("memory semantic status", () => {
  it("shows conflict before verification state", () => {
    expect(
      evidenceSemanticStatus({
        verificationStatus: "verified",
        extractionStatus: "extracted",
        hasOpenConflict: true,
      }),
    ).toBe("conflict");
  });

  it("shows AI generated for extracted unverified facts", () => {
    expect(
      factSemanticStatus({
        verificationStatus: "unverified",
        extractionStatus: "extracted",
      }),
    ).toBe("ai_generated");
  });
});

describe("memory authorization helper", () => {
  it("rejects cross-user access", () => {
    expect(() => assertOwnedMemory("owner", "other")).toThrow("MEMORY_FORBIDDEN");
  });
});

describe("memory RLS migration", () => {
  it("enables owner-scoped policies on memory_conflicts", () => {
    expect(migration).toContain("create table if not exists public.memory_conflicts");
    expect(migration).toContain("alter table public.memory_conflicts enable row level security");
    expect(migration).toContain("memory_conflicts_select_own");
    expect(migration).toContain("user_id = auth.uid()");
    expect(migration).toContain("grant select, insert, update, delete on public.memory_conflicts to authenticated");
    expect(migration).not.toContain("using (true)");
  });

  it("adds extraction and source columns to evidence and profile facts", () => {
    expect(migration).toContain("extraction_status");
    expect(migration).toContain("source_document_id");
    expect(migration).toContain("fact_key");
  });
});
