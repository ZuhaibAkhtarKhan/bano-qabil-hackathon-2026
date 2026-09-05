import { describe, expect, it } from "vitest";

import { isHostSubmissionConfirmed } from "@/server/applications/host-submit-confirm";
import { shouldSkipClaimedSubmitJob, summarizeHostSubmitJobs } from "@/server/applications/host-submit-policy";

describe("isHostSubmissionConfirmed", () => {
  it("requires recorded-response copy, not a bare /formResponse URL", () => {
    expect(
      isHostSubmissionConfirmed({
        href: "https://docs.google.com/forms/d/e/abc/formResponse",
        pageText: "",
      }),
    ).toBe(false);
  });

  it("accepts Google's recorded-response confirmation", () => {
    expect(
      isHostSubmissionConfirmed({
        href: "https://docs.google.com/forms/d/e/abc/formResponse",
        pageText: "Your response has been recorded",
      }),
    ).toBe(true);
  });

  it("does not treat a multi-page Next landing as submitted", () => {
    expect(
      isHostSubmissionConfirmed({
        href: "https://docs.google.com/forms/d/e/abc/formResponse",
        pageText: "* Indicates required question",
      }),
    ).toBe(false);
  });
});

describe("manual resubmit after a false host confirmation", () => {
  it("lets Resubmit run even when the application was marked submitted", () => {
    const falsePositive = summarizeHostSubmitJobs(
      [
        {
          status: "submitted",
          job_kind: "submit",
          host_submit_clicked: true,
          idempotency_key: "app-1:host_page_loop",
        },
      ],
      { status: "submitted", submitted_at: "2026-09-04T18:38:35.000Z" },
    );
    expect(falsePositive.applicationSubmitted).toBe(true);
    expect(falsePositive.hostSubmitSucceeded).toBe(true);
    expect(shouldSkipClaimedSubmitJob({ state: falsePositive, postDeadline: false, manual: true })).toBe(
      false,
    );
    expect(shouldSkipClaimedSubmitJob({ state: falsePositive, postDeadline: false, manual: false })).toBe(
      true,
    );
  });
});
