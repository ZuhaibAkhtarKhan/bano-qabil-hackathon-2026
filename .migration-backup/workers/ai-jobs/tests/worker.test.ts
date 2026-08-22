import { describe, expect, it } from "vitest";

import { processJob, selectRunnableJobs } from "../src/index";

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
});
