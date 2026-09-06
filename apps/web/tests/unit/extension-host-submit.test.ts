import { afterEach, describe, expect, it } from "vitest";

import {
  isExtensionHostSubmitEnabled,
  isHostAutomationSchedulingEnabled,
  isServerHostSubmitEnabled,
} from "@/server/applications/host-submit-flags";
import {
  ExtensionHostSubmitBeginSchema,
  ExtensionHostSubmitCompleteSchema,
  ExtensionHostSubmitJobSchema,
} from "@/server/extension/extension-host-submit";

describe("host-submit-flags", () => {
  const keys = [
    "ENABLE_HOST_AUTOMATION_SCHEDULE",
    "ENABLE_EXTENSION_HOST_SUBMIT",
    "ENABLE_SERVER_HOST_SUBMIT",
  ] as const;

  afterEach(() => {
    for (const key of keys) delete process.env[key];
  });

  it("schedules by default and prefers extension over Playwright", () => {
    expect(isHostAutomationSchedulingEnabled()).toBe(true);
    expect(isExtensionHostSubmitEnabled()).toBe(true);
    expect(isServerHostSubmitEnabled()).toBe(false);
  });

  it("respects explicit env overrides", () => {
    process.env.ENABLE_HOST_AUTOMATION_SCHEDULE = "false";
    process.env.ENABLE_EXTENSION_HOST_SUBMIT = "0";
    process.env.ENABLE_SERVER_HOST_SUBMIT = "true";
    expect(isHostAutomationSchedulingEnabled()).toBe(false);
    expect(isExtensionHostSubmitEnabled()).toBe(false);
    expect(isServerHostSubmitEnabled()).toBe(true);
  });
});

describe("extension host-submit contracts", () => {
  it("parses a claimed submit job payload", () => {
    const job = ExtensionHostSubmitJobSchema.parse({
      jobId: "11111111-1111-4111-8111-111111111111",
      applicationId: "22222222-2222-4222-8222-222222222222",
      sourceUrl: "https://docs.google.com/forms/d/e/abc/viewform",
      jobKind: "submit",
      clickFinalSubmit: true,
      dueAt: new Date().toISOString(),
      attemptCount: 1,
    });
    expect(job.clickFinalSubmit).toBe(true);
    expect(job.jobKind).toBe("submit");
  });

  it("parses a prefill job that must not click Submit", () => {
    const job = ExtensionHostSubmitJobSchema.parse({
      jobId: "11111111-1111-4111-8111-111111111111",
      applicationId: "22222222-2222-4222-8222-222222222222",
      sourceUrl: "https://form.jotform.com/123",
      jobKind: "prefill",
      clickFinalSubmit: false,
      dueAt: new Date().toISOString(),
      attemptCount: 1,
    });
    expect(job.clickFinalSubmit).toBe(false);
  });

  it("accepts complete payloads for success, needs-you, and blocked", () => {
    expect(
      ExtensionHostSubmitCompleteSchema.parse({
        jobId: "11111111-1111-4111-8111-111111111111",
        submitted: true,
        hostSubmitClicked: true,
        filledFields: 4,
      }).submitted,
    ).toBe(true);

    expect(
      ExtensionHostSubmitCompleteSchema.parse({
        jobId: "11111111-1111-4111-8111-111111111111",
        pausedForNeedsYou: true,
        missingRequired: ["Full Name"],
      }).pausedForNeedsYou,
    ).toBe(true);

    expect(
      ExtensionHostSubmitCompleteSchema.parse({
        jobId: "11111111-1111-4111-8111-111111111111",
        blockedReason: "CAPTCHA on the host form",
      }).blockedReason,
    ).toMatch(/CAPTCHA/);
  });

  it("parses a begin payload used to stop after status becomes submitted", () => {
    expect(
      ExtensionHostSubmitBeginSchema.parse({
        jobId: "11111111-1111-4111-8111-111111111111",
      }).jobId,
    ).toBe("11111111-1111-4111-8111-111111111111");
  });
});
