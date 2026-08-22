import { describe, expect, it, vi } from "vitest";

import { logInfo } from "@/lib/log";

describe("logInfo", () => {
  it("redacts sensitive keys", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logInfo("draft.generated", {
      userId: "user-1",
      email: "person@example.com",
      answer: "I invented a CERN internship.",
      prompt: "write a bio",
    });
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0])) as {
      metadata: Record<string, string>;
    };
    expect(payload.metadata.userId).toBe("user-1");
    expect(payload.metadata.email).toBe("[redacted]");
    expect(payload.metadata.answer).toBe("[redacted]");
    expect(payload.metadata.prompt).toBe("[redacted]");
    spy.mockRestore();
  });
});
