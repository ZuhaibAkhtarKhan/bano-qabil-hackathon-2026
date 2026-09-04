import { describe, expect, it } from "vitest";

import {
  shouldAutoQueueHostSubmit,
  shouldClickSubmitOnContinue,
  shouldContinueHostFill,
  shouldCreateNewAutoSubmitJob,
  shouldQueuePostDeadlineRetry,
  shouldSkipClaimedSubmitJob,
  summarizeHostSubmitJobs,
} from "@/server/applications/host-submit-policy";

describe("host submit attempt policy", () => {
  it("allows the first fill/submit and then stops after a successful submit", () => {
    const before = summarizeHostSubmitJobs([], { status: "in_progress" });
    expect(shouldContinueHostFill(before)).toBe(true);
    expect(shouldAutoQueueHostSubmit(before)).toBe(true);
    expect(shouldQueuePostDeadlineRetry(before)).toBe(false);

    const after = summarizeHostSubmitJobs(
      [{ status: "submitted", job_kind: "submit", host_submit_clicked: true }],
      { status: "submitted", submitted_at: "2026-09-04T00:00:00.000Z" },
    );
    expect(shouldContinueHostFill(after)).toBe(false);
    expect(shouldAutoQueueHostSubmit(after)).toBe(false);
    expect(shouldQueuePostDeadlineRetry(after)).toBe(false);
  });

  it("queues one post-deadline retry only after the first submit failed", () => {
    const failed = summarizeHostSubmitJobs(
      [
        {
          status: "failed",
          job_kind: "submit",
          host_submit_clicked: true,
          idempotency_key: "app-1:host_page_loop",
        },
      ],
      { status: "in_progress" },
    );
    expect(shouldContinueHostFill(failed)).toBe(false);
    expect(shouldAutoQueueHostSubmit(failed)).toBe(false);
    expect(shouldQueuePostDeadlineRetry(failed)).toBe(true);

    const afterPost = summarizeHostSubmitJobs(
      [
        {
          status: "failed",
          job_kind: "submit",
          host_submit_clicked: true,
          idempotency_key: "app-1:host_page_loop",
        },
        {
          status: "failed",
          job_kind: "submit",
          host_submit_clicked: true,
          idempotency_key: "app-1:host_submit:post_deadline:2026-09-10T00:00:00.000Z",
        },
      ],
      { status: "in_progress" },
    );
    expect(shouldQueuePostDeadlineRetry(afterPost)).toBe(false);
  });

  it("still continues a Need You pause when Submit was never clicked", () => {
    const paused = summarizeHostSubmitJobs(
      [
        {
          status: "completed",
          job_kind: "submit",
          host_submit_clicked: false,
          last_error: "waiting_needs_you",
          idempotency_key: "app-1:host_page_loop",
        },
      ],
      { status: "in_progress" },
    );
    expect(shouldContinueHostFill(paused)).toBe(true);
    expect(shouldClickSubmitOnContinue(paused)).toBe(true);
    expect(shouldCreateNewAutoSubmitJob(paused)).toBe(false);
    expect(shouldAutoQueueHostSubmit(paused)).toBe(false);
    expect(shouldQueuePostDeadlineRetry(paused)).toBe(false);
    expect(
      shouldSkipClaimedSubmitJob({ state: paused, postDeadline: true, manual: false }),
    ).toBe(true);
    expect(
      shouldSkipClaimedSubmitJob({ state: paused, postDeadline: false, manual: false }),
    ).toBe(true);
  });

  it("does not queue a second auto-submit key while a page-loop submit job exists", () => {
    const inFlight = summarizeHostSubmitJobs(
      [
        {
          status: "pending",
          job_kind: "submit",
          host_submit_clicked: false,
          idempotency_key: "app-1:host_page_loop",
        },
      ],
      { status: "in_progress" },
    );
    expect(shouldCreateNewAutoSubmitJob(inFlight)).toBe(false);
    expect(shouldSkipClaimedSubmitJob({ state: inFlight, postDeadline: false, manual: false })).toBe(
      false,
    );
  });
});
