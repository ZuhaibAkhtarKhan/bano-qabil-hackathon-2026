import { describe, expect, it, vi } from "vitest";

import {
  JobRegistry,
  createProcessor,
  processJob,
  runWorkerCycle,
  selectRunnableJobs,
  type JobRow,
} from "../src/index";

describe("job worker", () => {
  it("runs only queued jobs whose backoff has elapsed", () => {
    const now = new Date("2026-08-18T00:00:00.000Z");
    const runnable = selectRunnableJobs(
      [
        { state: "queued", next_attempt_at: null },
        { state: "processing" },
        { state: "queued", next_attempt_at: "2026-08-18T01:00:00.000Z" },
        { state: "failed" },
      ],
      now,
    );
    expect(runnable).toHaveLength(1);
  });

  it("fails unknown job types instead of inventing work", async () => {
    const result = await processJob([], {
      id: "1",
      user_id: "u",
      type: "document_extract",
      state: "queued",
      attempts: 0,
      max_attempts: 3,
      input_ref: "x",
      error_code: null,
    });
    expect(result).toBe("failed");
  });

  it("registers and executes jobs with JobRegistry", async () => {
    const registry = new JobRegistry();
    const executed: string[] = [];

    registry.registerHandler("opportunity_analyze", async (job) => {
      executed.push(job.id);
    });

    const job: JobRow = {
      id: "job-123",
      user_id: "user-abc",
      type: "opportunity_analyze",
      state: "queued",
      attempts: 0,
      max_attempts: 3,
      input_ref: "opp-123",
      error_code: null,
    };

    expect(registry.has("opportunity_analyze")).toBe(true);
    expect(registry.has("document_extract")).toBe(false);

    const result = await processJob(registry, job);
    expect(result).toBe("completed");
    expect(executed).toEqual(["job-123"]);
  });

  it("handles processor errors gracefully without crashing the cycle", async () => {
    const registry = new JobRegistry();
    registry.register(
      createProcessor("document_extract", async () => {
        throw new Error("CORRUPT_DOCUMENT");
      }),
    );

    const job: JobRow = {
      id: "job-err",
      user_id: "u",
      type: "document_extract",
      state: "queued",
      attempts: 0,
      max_attempts: 3,
      input_ref: "doc-1",
      error_code: null,
    };

    const result = await processJob(registry, job);
    expect(result).toBe("failed");
  });

  it("runs full worker cycle over multiple jobs and fires lifecycle hooks", async () => {
    const registry = new JobRegistry();
    registry.registerHandler("deadline_monitor", async () => {
      // success
    });

    const started = vi.fn();
    const completed = vi.fn();
    const failed = vi.fn();

    const jobs: JobRow[] = [
      {
        id: "j1",
        user_id: "u1",
        type: "deadline_monitor",
        state: "queued",
        attempts: 0,
        max_attempts: 3,
        input_ref: "ref1",
        error_code: null,
      },
      {
        id: "j2",
        user_id: "u1",
        type: "account_export",
        state: "queued",
        attempts: 0,
        max_attempts: 3,
        input_ref: "ref2",
        error_code: null,
      },
    ];

    const cycleResult = await runWorkerCycle(registry, {
      fetchQueuedJobs: async () => jobs,
      onJobStarted: started,
      onJobCompleted: completed,
      onJobFailed: failed,
    });

    expect(cycleResult.processed).toBe(2);
    expect(cycleResult.succeeded).toBe(1);
    expect(cycleResult.failed).toBe(1);
    expect(started).toHaveBeenCalledTimes(2);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(1);
  });
});
