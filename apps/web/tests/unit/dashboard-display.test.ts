import { describe, expect, it } from "vitest";

import { APPLICATION_LIFECYCLE_ACTIONS } from "@/lib/application-lifecycle";
import { applicationTableMeta, toApplicationsTrackerRow } from "@/lib/dashboard-display";

describe("applicationTableMeta", () => {
  it("shows Submitted before Need you when submitted_at is set", () => {
    const meta = applicationTableMeta("review_required", APPLICATION_LIFECYCLE_ACTIONS.NEEDS_YOU, {
      needsYouCount: 0,
      submittedAt: "2026-09-02T12:00:00.000Z",
    });
    expect(meta.statusLabel).toBe("Submitted");
    expect(meta.statusTone).toBe("mint");
  });

  it("does not treat a frozen packet as Submitted without a host submit", () => {
    const meta = applicationTableMeta(
      "in_progress",
      "Packet frozen. 1-Apply has not submitted the host form.",
      { needsYouCount: 0 },
    );
    expect(meta.statusLabel).not.toBe("Submitted");
  });

  it("does not show Need you when queue count is zero and only review_required remains", () => {
    const meta = applicationTableMeta("review_required", APPLICATION_LIFECYCLE_ACTIONS.ANALYZED, {
      needsYouCount: 0,
    });
    expect(meta.statusLabel).toBe("In review");
    expect(meta.statusTone).toBe("teal");
  });

  it("shows Need you when queue count is positive", () => {
    const meta = applicationTableMeta("in_progress", null, { needsYouCount: 3 });
    expect(meta.statusLabel).toBe("Need you");
  });
});

describe("toApplicationsTrackerRow", () => {
  it("uses Not submitted until submitted_at exists", () => {
    const row = toApplicationsTrackerRow(
      {
        id: "app-1",
        status: "in_progress",
        next_action: null,
        submitted_at: null,
        updated_at: "2026-09-02T12:00:00.000Z",
        opportunities: { title: "Engineer", organization: "Acme" },
      },
      0,
    );
    expect(row.appliedLabel).toBe("Not submitted");
  });
});
