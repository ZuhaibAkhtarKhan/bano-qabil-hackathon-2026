/** Format phone / WhatsApp / CNIC-style values to match field instructions. */

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Academic year label from enrollment years (e.g. 2024–2028 → "3rd year" in late 2026). */
export function deriveYearOfStudy(years: number[], now = new Date()): string | null {
  const unique = [...new Set(years.filter((year) => year >= 1980 && year <= 2040))].sort((a, b) => a - b);
  if (!unique.length) return null;
  const start = unique[0]!;
  const end = unique[unique.length - 1]!;
  const current = now.getFullYear();
  const month = now.getMonth(); // 0–11
  if (current > end || (current === end && month >= 7)) return "Graduated / Post Graduated";
  if (current < start) return null;

  // Fall-start academic calendar (common for PK universities): Aug–Jul cohort year.
  // In Aug 2026 with start 2024 → 3rd; in Feb 2026 with start 2024 → still 2nd.
  const academicYear = month >= 7 ? current - start + 1 : current - start;
  const yearNum = Math.min(6, Math.max(1, academicYear || 1));
  const ordinals = ["1st", "2nd", "3rd", "4th", "5th", "6th"] as const;
  return `${ordinals[yearNum - 1]} year`;
}

export function extractYearsFromText(value: string): number[] {
  return [...value.matchAll(/\b(?:19|20)\d{2}\b/g)]
    .map((match) => Number(match[0]))
    .filter((year) => year >= 1980 && year <= 2040);
}

/**
 * Adapt a stored phone/CNIC/contact number to the field's requested format
 * (with/without +92, dashes, spaces, 10-digit local, etc.).
 */
export function formatIdentityNumberForField(raw: string, fieldSignals: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const signals = fieldSignals.toLowerCase();
  const digits = digitsOnly(trimmed);

  const isCnic =
    /\bcnic\b|\bnic\b|nadra|national identity|identity card|cnic number/i.test(signals) ||
    (digits.length === 13 && !/\b(phone|mobile|whatsapp|telephone|cell)\b/i.test(signals));

  if (isCnic && digits.length >= 13) {
    const cnic = digits.slice(0, 13);
    if (/without\s*(dash|hyphen)|no\s*(dash|hyphen)|without\s*[-–]|digits only/i.test(signals)) {
      return cnic;
    }
    return `${cnic.slice(0, 5)}-${cnic.slice(5, 12)}-${cnic.slice(12)}`;
  }

  // Normalize PK / common mobile to 10-digit national significant number (3XXXXXXXXX).
  let core = digits;
  if (core.startsWith("0092")) core = core.slice(4);
  else if (core.startsWith("92") && core.length >= 12) core = core.slice(2);
  if (core.startsWith("0") && core.length === 11) core = core.slice(1);
  if (core.length > 10) core = core.slice(-10);

  const wantsNoCountry = /without\s*(country|code|\+?92)|no\s*(country|code)|10\s*-?\s*digit|ten\s*digit/i.test(signals);
  const wantsCountry =
    !wantsNoCountry &&
    /(\+|plus)\s*92|with\s*(country|code|\+?92)|country\s*code|international/i.test(signals);
  const wantsNoSep = /without\s*(spacing|space|dash|hyphen)|no\s*(space|spacing|dash|hyphen)|10\s*-?\s*digit/i.test(signals);
  const wantsDashes = /with\s*(dash|hyphen)|dashed/i.test(signals) && !wantsNoSep;

  const dashedLocal = (value: string) => {
    if (value.length === 10) return `${value.slice(0, 3)}-${value.slice(3)}`;
    if (value.length === 11 && value.startsWith("0")) return `${value.slice(0, 4)}-${value.slice(4)}`;
    return value;
  };

  if (wantsNoCountry || (!wantsCountry && /whatsapp|10\s*-?\s*digit|ten\s*digit/i.test(signals))) {
    if (wantsDashes) return dashedLocal(core);
    return core;
  }

  if (wantsCountry) {
    const body = `92${core}`;
    if (/\+|\bplus\b/i.test(signals) || trimmed.includes("+")) {
      return wantsNoSep ? `+${body}` : `+${body}`;
    }
    return wantsDashes ? `92-${dashedLocal(core)}` : body;
  }

  // Default: keep a practical local form; prefer 03XX style if memory had a leading 0.
  if (/^0?3\d{9}$/.test(core) || core.length === 10) {
    if (digits.startsWith("0") && digits.length === 11) {
      return wantsNoSep ? digits : dashedLocal(digits);
    }
    if (trimmed.includes("+") || digits.startsWith("92")) {
      return `+92${core}`;
    }
    return wantsNoSep ? core : trimmed;
  }

  return trimmed;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;
const ISO_TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Convert a memory value to HTML date input form, or null when it is not a real calendar date. */
export function toHtmlDateValue(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > 40) return null;
  if (/mon\s*-?\s*fri|weekdays?|availability|full[- ]?time|part[- ]?time/i.test(text)) return null;
  const iso = text.match(ISO_DATE);
  if (iso) {
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  if (!/\d{4}/.test(text) || /[a-z]{8,}/i.test(text)) return null;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** True when `value` can be assigned to a native input without a browser format error. */
export function valueFitsNativeInput(value: string, inputType: string): boolean {
  const text = value.trim();
  if (!text) return false;
  const type = inputType.toLowerCase();
  if (type === "date") {
    const iso = toHtmlDateValue(text);
    return Boolean(iso && ISO_DATE.test(iso));
  }
  if (type === "month") return ISO_MONTH.test(text);
  if (type === "time") return ISO_TIME.test(text);
  if (type === "datetime-local") return ISO_DATETIME.test(text.replace(" ", "T"));
  if (type === "week") return /^\d{4}-W\d{2}$/i.test(text);
  if (type === "number" || type === "range") return /^-?\d+(\.\d+)?$/.test(text);
  if (type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) && text.length < 254;
  if (type === "url") return /^(https?:\/\/|www\.)/i.test(text) || /^[a-z0-9.-]+\.[a-z]{2,}([/?#].*)?$/i.test(text);
  if (type === "tel") return text.length <= 32 && /[\d+]/.test(text) && !/[a-z]{8,}/i.test(text);
  return true;
}
