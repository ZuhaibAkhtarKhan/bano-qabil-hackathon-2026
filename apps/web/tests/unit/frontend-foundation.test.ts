import { describe, expect, it } from "vitest";

import { dashboardBuckets } from "@/lib/dashboard";
import { SEMANTIC_STATUS, answerSemanticStatus, evidenceSemanticStatus } from "@/lib/status";
import { WORKSPACE_NAV } from "@/components/app/nav";
import type { ApplicationListRow } from "@/server/types";

function application(partial: Partial<ApplicationListRow> & Pick<ApplicationListRow, "id" | "status">): ApplicationListRow {
  return {
    opportunity_id: "opp-1",
    deadline_at: null,
    next_action: null,
    submitted_at: null,
    updated_at: "2026-08-01T00:00:00.000Z",
    opportunities: {
      title: "Research intern",
      organization: "Lab",
      category: "internship",
      source_url: null,
    },
    fit_evaluations: null,
    ...partial,
  };
}

describe("semantic states", () => {
  it("does not style AI-generated content like verified evidence", () => {
    const verified = SEMANTIC_STATUS.verified;
    const generated = SEMANTIC_STATUS.ai_generated;
    expect(generated.pattern).toBe("dashed");
    expect(verified.pattern).toBe("solid");
    expect(generated.tone).not.toBe(verified.tone);
    expect(generated.label).not.toBe(verified.label);
  });

  it("maps evidence and answers onto distinct statuses", () => {
    expect(evidenceSemanticStatus({ verificationStatus: "verified" })).toBe("verified");
    expect(evidenceSemanticStatus({ verificationStatus: "unverified" })).toBe("needs_review");
    expect(answerSemanticStatus("ai_generated")).toBe("ai_generated");
    expect(answerSemanticStatus("approved")).toBe("approved");
    expect(answerSemanticStatus("user_edited")).toBe("user_edited");
  });
});

describe("dashboard buckets", () => {
  it("stays empty when there are no applications", () => {
    expect(dashboardBuckets([])).toEqual({
      active: [],
      submitted: [],
      interviews: [],
      deadlines: [],
      attention: [],
      recent: [],
      prioritized: [],
    });
  });

  it("groups real rows without inventing a pipeline", () => {
    const now = Date.parse("2026-08-18T00:00:00.000Z");
    const rows = [
      application({ id: "a", status: "draft" }),
      application({ id: "b", status: "preparing", next_action: "Needs review of unclear eligibility" }),
      application({ id: "c", status: "submitted" }),
      application({ id: "d", status: "interview" }),
      application({
        id: "e",
        status: "ready",
        deadline_at: "2026-09-01T00:00:00.000Z",
      }),
      application({
        id: "f",
        status: "rejected",
        deadline_at: "2026-09-02T00:00:00.000Z",
      }),
    ];
    const buckets = dashboardBuckets(rows, now);
    expect(buckets.active.map((row) => row.id)).toEqual(["a", "b", "e"]);
    expect(buckets.submitted.map((row) => row.id)).toEqual(["c"]);
    expect(buckets.interviews.map((row) => row.id)).toEqual(["d"]);
    expect(buckets.deadlines.map((row) => row.id)).toEqual(["e"]);
    expect(buckets.attention.map((row) => row.id)).toEqual(["b"]);
    expect(buckets.recent.map((row) => row.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});

describe("workspace navigation", () => {
  it("exposes the extensible application OS destinations", () => {
    const hrefs = WORKSPACE_NAV.flatMap((section) => section.items.map((item) => item.href));
    expect(hrefs).toEqual([
      "/app",
      "/app/opportunities",
      "/app/applications",
      "/app/memory",
      "/app/notifications",
      "/app/settings",
    ]);
  });
});
