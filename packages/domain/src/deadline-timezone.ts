type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function getZonedDateTimeParts(date: Date, timeZone: string): ZonedParts | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? NaN);
    const hour = get("hour");
    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: hour === 24 ? 0 : hour,
      minute: get("minute"),
      second: get("second"),
    };
  } catch {
    return null;
  }
}

function partsToUtcMs(parts: ZonedParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/** Parse a datetime-local string as wall time in an IANA timezone and return UTC ISO. */
export function parseDeadlineLocalInput(localValue: string, timeZone: string | null): string | null {
  const trimmed = localValue.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) {
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }

  const desired: ZonedParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: match[6] ? Number(match[6]) : 0,
  };

  if (!timeZone) {
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }

  let guess = partsToUtcMs(desired);
  for (let i = 0; i < 4; i++) {
    const zoned = getZonedDateTimeParts(new Date(guess), timeZone);
    if (!zoned) break;
    guess += partsToUtcMs(desired) - partsToUtcMs(zoned);
  }
  return new Date(guess).toISOString();
}

/** Format a UTC deadline for HTML datetime-local inputs in the stored timezone. */
export function formatDeadlineLocalInput(deadlineAtUtc: string | null, timeZone: string | null): string {
  if (!deadlineAtUtc) return "";
  const date = new Date(deadlineAtUtc);
  if (Number.isNaN(date.getTime())) return "";

  if (timeZone) {
    const parts = getZonedDateTimeParts(date, timeZone);
    if (parts) {
      return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
    }
  }

  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** True when the deadline instant is now or in the past. */
export function isDeadlineInPast(deadlineAtUtc: string | null, now: Date = new Date()): boolean {
  if (!deadlineAtUtc) return false;
  const deadline = new Date(deadlineAtUtc);
  if (Number.isNaN(deadline.getTime())) return false;
  return deadline.getTime() <= now.getTime();
}

/** Minimum datetime-local value — current time in the given timezone (for HTML min=). */
export function minDeadlineLocalInput(timeZone: string | null, now: Date = new Date()): string {
  return formatDeadlineLocalInput(now.toISOString(), timeZone);
}

/** True when a date-only deadline (YYYY-MM-DD) is before today (UTC calendar day). */
export function isDeadlineDateInPast(deadlineAtUtc: string | null, now: Date = new Date()): boolean {
  if (!deadlineAtUtc) return false;
  const deadline = new Date(deadlineAtUtc);
  if (Number.isNaN(deadline.getTime())) return false;
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const deadlineUtc = Date.UTC(deadline.getUTCFullYear(), deadline.getUTCMonth(), deadline.getUTCDate());
  return deadlineUtc < todayUtc;
}

export function minDeadlineDateInput(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
