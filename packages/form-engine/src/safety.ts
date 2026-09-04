import type { DetectedField } from "./types";

const PROTECTED = [
  /captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /turnstile/i,
  /\bsubmit\b/i,
  /signature/i,
  /e-?sign/i,
  /attest/i,
  /payment/i,
  /credit.?card/i,
  /card.?number/i,
  /cvv/i,
  /password/i,
  /\bmfa\b/i,
  /\b2fa\b/i,
  /\botp\b/i,
  /one.?time/i,
  /ssn|social.?security/i,
];

/** reCAPTCHA / hCaptcha challenge copy — often captured as a fake form question. */
export function isCaptchaChallengeCopy(text: string): boolean {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return false;
  return (
    /type the text you hear or see/i.test(value) ||
    /type what you (hear|see)/i.test(value) ||
    /\bi'?m not a robot\b/i.test(value) ||
    /select all (squares|images|pictures) (with|that)/i.test(value) ||
    /verify (you are|that you'?re) (a )?human/i.test(value) ||
    /complete the captcha/i.test(value) ||
    /\b(hcaptcha|recaptcha|cloudflare turnstile)\b/i.test(value) ||
    /please (solve|complete) this (security )?challenge/i.test(value)
  );
}

const SENSITIVE = [
  /citizenship/i,
  /work.?authorization/i,
  /visa.?status/i,
  /authorized.?to.?work/i,
  /race|ethnicity|hispanic/i,
  /gender|sex\b/i,
  /disability|disabled/i,
  /veteran/i,
  /criminal|conviction|felony/i,
  /demographic/i,
  /date of birth|birthdate|dob\b/i,
  /passport|national.?id/i,
  /ssn|social.?security/i,
  /legal.?name.?attestation/i,
];

export function isProtectedControl(field: {
  name: string;
  label: string;
  type: string;
  role?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  nearbyText?: string;
}): boolean {
  const haystack = `${field.name} ${field.id ?? ""} ${field.label} ${field.placeholder ?? ""} ${field.ariaLabel ?? ""} ${field.nearbyText ?? ""} ${field.type} ${field.role ?? ""}`;
  if (isCaptchaChallengeCopy(haystack)) return true;
  if (PROTECTED.some((pattern) => pattern.test(haystack))) return true;
  if (field.type === "submit" || field.type === "password" || field.type === "button") return true;
  if (field.role === "button" && /submit|pay|sign|register/i.test(field.label)) return true;
  return false;
}

export function isSensitiveField(field: {
  name: string;
  label: string;
  type?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  nearbyText?: string;
}): boolean {
  const haystack = `${field.name} ${field.id ?? ""} ${field.label} ${field.placeholder ?? ""} ${field.ariaLabel ?? ""} ${field.nearbyText ?? ""}`;
  return SENSITIVE.some((pattern) => pattern.test(haystack));
}

export function proposedFillTargets(fields: DetectedField[]): DetectedField[] {
  return fields.filter((field) => !isProtectedControl(field) && field.type !== "file");
}

export function fillTargetAllowed(fieldKey: string, type: string): boolean {
  return !isProtectedControl({ name: fieldKey, label: fieldKey, type, id: fieldKey });
}

export function isForbiddenFillAction(action: string, options?: { hostSubmitAllowed?: boolean }): boolean {
  if (options?.hostSubmitAllowed && (action === "submit" || action === "clickSubmit")) {
    return false;
  }
  return action === "submit" || action === "clickSubmit" || action === "bypassCaptcha" || action === "createAccount";
}
