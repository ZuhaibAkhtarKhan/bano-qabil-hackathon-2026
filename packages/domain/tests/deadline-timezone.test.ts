import { describe, expect, it } from "vitest";

import {
  formatDeadlineLocalInput,
  isDeadlineDateInPast,
  isDeadlineInPast,
  parseDeadlineLocalInput,
} from "../src/deadline-timezone";

describe("deadline timezone helpers", () => {
  it("parses datetime-local in an IANA timezone to UTC", () => {
    const iso = parseDeadlineLocalInput("2026-09-02T18:31", "Asia/Karachi");
    expect(iso).toBe("2026-09-02T13:31:00.000Z");
  });

  it("formats UTC deadlines back into datetime-local for the stored timezone", () => {
    const local = formatDeadlineLocalInput("2026-09-02T13:31:00.000Z", "Asia/Karachi");
    expect(local).toBe("2026-09-02T18:31");
  });

  it("round-trips datetime-local values", () => {
    const iso = parseDeadlineLocalInput("2026-09-02T18:31", "America/New_York");
    expect(formatDeadlineLocalInput(iso, "America/New_York")).toBe("2026-09-02T18:31");
  });

  it("detects past deadlines", () => {
    expect(isDeadlineInPast("2020-01-01T00:00:00.000Z", new Date("2026-01-01T00:00:00.000Z"))).toBe(true);
    expect(isDeadlineInPast("2027-01-01T00:00:00.000Z", new Date("2026-01-01T00:00:00.000Z"))).toBe(false);
    expect(isDeadlineInPast(null)).toBe(false);
  });

  it("blocks past date-only deadlines", () => {
    const now = new Date("2026-09-02T12:00:00.000Z");
    expect(isDeadlineDateInPast("2026-09-01T00:00:00.000Z", now)).toBe(true);
    expect(isDeadlineDateInPast("2026-09-02T00:00:00.000Z", now)).toBe(false);
    expect(isDeadlineDateInPast("2026-09-03T00:00:00.000Z", now)).toBe(false);
  });
});
