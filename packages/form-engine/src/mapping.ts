import { isProtectedControl, isSensitiveField } from "./safety";
import type { DetectedField, FieldMapping, MemoryValue } from "./types";

type Rule = {
  path: string;
  aliases: string[];
  minConfidence: number;
};

const RULES: Rule[] = [
  { path: "Education → Institution", aliases: ["university", "college", "school", "institution", "campus"], minConfidence: 0.9 },
  { path: "Education → Degree", aliases: ["degree", "qualification", "program of study"], minConfidence: 0.85 },
  { path: "Education → Graduation year", aliases: ["graduation", "grad year", "class of", "year of graduation"], minConfidence: 0.85 },
  { path: "Education → GPA", aliases: ["gpa", "grade point"], minConfidence: 0.9 },
  { path: "Profile → GitHub", aliases: ["github", "git hub"], minConfidence: 0.99 },
  { path: "Profile → LinkedIn", aliases: ["linkedin"], minConfidence: 0.99 },
  { path: "Profile → Portfolio", aliases: ["portfolio", "personal website", "website"], minConfidence: 0.8 },
  { path: "Profile → Full name", aliases: ["full name", "legal name", "applicant name", "your name"], minConfidence: 0.9 },
  { path: "Profile → First name", aliases: ["first name", "given name", "forename"], minConfidence: 0.95 },
  { path: "Profile → Last name", aliases: ["last name", "surname", "family name"], minConfidence: 0.95 },
  { path: "Profile → Email", aliases: ["email", "e-mail"], minConfidence: 0.95 },
  { path: "Profile → Phone", aliases: ["phone", "mobile", "telephone"], minConfidence: 0.9 },
  { path: "Profile → Location", aliases: ["city", "location", "address", "country"], minConfidence: 0.7 },
  { path: "Approved Application Answer", aliases: ["why are you interested", "why do you want", "motivation", "cover letter", "personal statement", "tell us about yourself"], minConfidence: 0.88 },
];

function confidenceFor(signals: string, aliases: string[]): number {
  let best = 0;
  for (const alias of aliases) {
    if (signals.includes(alias)) {
      const exact = new RegExp(`(?:^|[^a-z])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z])`).test(signals);
      best = Math.max(best, exact ? 0.99 : 0.72);
    }
  }
  return best;
}

function memoryFor(path: string, catalog: MemoryValue[]): MemoryValue | undefined {
  return catalog.find((item) => item.path === path || item.aliases.some((alias) => path.toLowerCase().includes(alias)));
}

export function mapField(field: DetectedField, catalog: MemoryValue[]): FieldMapping {
  const signals = field.signals || `${field.label} ${field.name} ${field.id} ${field.placeholder} ${field.ariaLabel} ${field.nearbyText}`.toLowerCase();
  const protectedControl = isProtectedControl(field);
  const sensitive = isSensitiveField(field) || protectedControl;

  if (protectedControl) {
    return {
      fieldKey: field.key,
      label: field.label || field.name || field.key,
      memoryPath: "Blocked",
      source: "Safety rule",
      confidence: 0,
      proposedValue: "",
      approvalState: "blocked",
      sensitive: true,
      excludedByDefault: true,
      reason: "Protected control (CAPTCHA, submit, signature, payment, or password). 1-Apply will not fill it.",
      fieldType: field.type,
    };
  }

  if (field.type === "file") {
    return {
      fieldKey: field.key,
      label: field.label || field.name || field.key,
      memoryPath: "Documents → Resume",
      source: "Application Memory",
      confidence: 0.4,
      proposedValue: "",
      approvalState: "blocked",
      sensitive: false,
      excludedByDefault: true,
      reason: "File inputs cannot be set by the extension. Attach the version in 1-Apply or upload it yourself.",
      fieldType: field.type,
    };
  }

  let best: { rule: Rule; score: number } | null = null;
  for (const rule of RULES) {
    const score = confidenceFor(signals, rule.aliases);
    if (score >= rule.minConfidence && (!best || score > best.score)) best = { rule, score };
  }

  const ambiguousName = /\bname\b/.test(signals) && !/(full|first|last|given|family|user|university|school|company)/.test(signals);
  if (!best && ambiguousName) {
    return {
      fieldKey: field.key,
      label: field.label || field.name || field.key,
      memoryPath: "Profile → Full name",
      source: "Application Memory",
      confidence: 0.42,
      proposedValue: memoryFor("Profile → Full name", catalog)?.value ?? "",
      approvalState: "pending",
      sensitive,
      excludedByDefault: true,
      reason: "Ambiguous “name” field. Confirm whether this is your name, a university, or something else.",
      fieldType: field.type,
    };
  }

  if (!best) {
    return {
      fieldKey: field.key,
      label: field.label || field.name || field.key,
      memoryPath: "Unmapped",
      source: "None",
      confidence: 0,
      proposedValue: "",
      approvalState: sensitive ? "blocked" : "pending",
      sensitive,
      excludedByDefault: true,
      reason: sensitive
        ? "Sensitive field. Kept under explicit user control and excluded unless you approve it."
        : "Could not map this field to Application Memory. Continue it manually.",
      fieldType: field.type,
    };
  }

  const memory = catalog.find((item) => item.path === best.rule.path) ?? catalog.find((item) => item.aliases.some((alias) => best.rule.aliases.includes(alias)));
  const proposedValue = memory?.value ?? "";
  const approvalState: FieldMapping["approvalState"] = sensitive ? "blocked" : proposedValue ? "pending" : "pending";

  return {
    fieldKey: field.key,
    label: field.label || field.name || field.key,
    memoryPath: best.rule.path,
    source: memory?.source ?? "Application Memory",
    confidence: Math.round(best.score * 100) / 100,
    proposedValue,
    approvalState: sensitive ? "blocked" : approvalState,
    sensitive,
    excludedByDefault: sensitive || best.score < 0.8 || !proposedValue,
    reason: sensitive
      ? "Sensitive field. Kept under explicit user control and excluded unless you approve it."
      : proposedValue
        ? `Mapped from ${memory?.source ?? "Application Memory"} (${best.rule.path}).`
        : `Mapped to ${best.rule.path}, but no verified value is stored yet.`,
    fieldType: field.type,
  };
}

export function mapFields(fields: DetectedField[], catalog: MemoryValue[]): FieldMapping[] {
  return fields.map((field) => mapField(field, catalog));
}
