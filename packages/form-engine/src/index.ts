export type InventoriesField = {
  name: string;
  label: string;
  type: string;
  role?: string;
};

const PROTECTED = [
  /captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /\bsubmit\b/i,
  /signature/i,
  /attest/i,
  /payment/i,
  /credit.?card/i,
  /password/i,
  /\bmfa\b/i,
  /\b2fa\b/i,
  /\botp\b/i,
  /one.?time/i,
];

export function isProtectedControl(field: InventoriesField): boolean {
  const haystack = `${field.name} ${field.label} ${field.type} ${field.role ?? ""}`;
  if (PROTECTED.some((pattern) => pattern.test(haystack))) return true;
  if (field.type === "submit" || field.type === "password") return true;
  if (field.role === "button" && /submit|pay|sign/i.test(field.label)) return true;
  return false;
}

export function proposedFillTargets(fields: InventoriesField[]): InventoriesField[] {
  return fields.filter((field) => !isProtectedControl(field));
}
