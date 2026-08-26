export type KitDocumentKind =
  | "resume"
  | "identity_document"
  | "family_document"
  | "transcript"
  | "cover_letter"
  | "certificate"
  | "portfolio"
  | "supporting_document"
  | "other";

export type VaultDocument = {
  id: string;
  type: string;
  label: string;
  currentVersionId: string | null;
};

export type PacketLane = "needs_you" | "sends_at_deadline" | "waiting_host" | "watching";

export type PacketAnswer = {
  questionId: string;
  state: string | null;
  approvedText?: string | null;
  userEditedText?: string | null;
  originalAiText?: string | null;
};

export type KitStatus = {
  hasName: boolean;
  hasUniversity: boolean;
  hasEducation: boolean;
  hasResume: boolean;
  hasIdentityDocument: boolean;
  hasFamilyDocument: boolean;
  ready: boolean;
  missing: string[];
};

const STOP = new Set(["the", "and", "for", "with", "from", "copy", "scan", "scanned", "original", "attested", "upload", "file", "document", "pdf"]);

const KIND_PATTERNS: Array<{ kind: Exclude<KitDocumentKind, "other">; patterns: RegExp[] }> = [
  {
    kind: "identity_document",
    patterns: [/\bcnic\b/, /\bnic\b/, /\bnicop\b/, /national id/, /identity card/, /\bnadra\b/, /\bpassport\b/, /\bid card\b/],
  },
  {
    kind: "family_document",
    patterns: [/\bb[\s-]?form\b/, /\bbay form\b/, /family registration/, /child registration/, /form b\b/],
  },
  { kind: "resume", patterns: [/\bresume\b/, /\bcv\b/, /curriculum vitae/] },
  { kind: "cover_letter", patterns: [/cover letter/, /covering letter/] },
  { kind: "transcript", patterns: [/\btranscript\b/, /mark\s*-?\s*sheet/, /academic record/, /grade report/] },
  { kind: "certificate", patterns: [/\bcertificate\b/, /\bdiploma\b/] },
  { kind: "portfolio", patterns: [/\bportfolio\b/] },
];

const TYPE_TO_KIND: Record<string, KitDocumentKind> = {
  resume: "resume",
  resume_variant: "resume",
  identity_document: "identity_document",
  family_document: "family_document",
  transcript: "transcript",
  cover_letter: "cover_letter",
  certificate: "certificate",
  portfolio: "portfolio",
  supporting_document: "supporting_document",
  other: "other",
};

export function classifyRequiredDocumentLabel(label: string): KitDocumentKind {
  const text = label.toLowerCase();
  for (const { kind, patterns } of KIND_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(text))) return kind;
  }
  return "other";
}

export function classifyVaultDocument(doc: { type: string; label: string }): KitDocumentKind {
  const fromType = TYPE_TO_KIND[doc.type];
  if (fromType && fromType !== "other" && fromType !== "supporting_document") return fromType;
  const fromLabel = classifyRequiredDocumentLabel(doc.label);
  if (fromLabel !== "other") return fromLabel;
  return fromType ?? "other";
}

export function packetAnswerText(answer: {
  approvedText?: string | null;
  userEditedText?: string | null;
  originalAiText?: string | null;
} | null | undefined): string | null {
  if (!answer) return null;
  const text =
    (answer.approvedText ?? "").trim() ||
    (answer.userEditedText ?? "").trim() ||
    (answer.originalAiText ?? "").trim();
  return text || null;
}

export function requiredDocumentCovered(
  requiredLabel: string,
  attached: Array<{ type: string; label: string }>,
): boolean {
  const requiredKind = classifyRequiredDocumentLabel(requiredLabel);
  const requiredTokens = tokens(requiredLabel);
  return attached.some((doc) => {
    if (doc.label.trim().toLowerCase() === requiredLabel.trim().toLowerCase()) return true;
    const attachedKind = classifyVaultDocument(doc);
    if (requiredKind !== "other" && attachedKind === requiredKind) return true;
    const attachedTokens = tokens(doc.label);
    const overlap = [...requiredTokens].filter((token) => attachedTokens.has(token));
    return overlap.length >= 2 || (overlap.length === 1 && [...overlap][0]!.length >= 5);
  });
}

export function matchVaultDocument(
  requiredLabel: string,
  vault: VaultDocument[],
  usedIds: Set<string> = new Set(),
): VaultDocument | null {
  const available = vault.filter((doc) => doc.currentVersionId && !usedIds.has(doc.id));
  if (available.length === 0) return null;

  const requiredKind = classifyRequiredDocumentLabel(requiredLabel);
  const requiredTokens = tokens(requiredLabel);

  const scored = available
    .map((doc) => {
      const kind = classifyVaultDocument(doc);
      let score = 0;
      if (doc.label.trim().toLowerCase() === requiredLabel.trim().toLowerCase()) score += 8;
      if (requiredKind !== "other" && kind === requiredKind) score += 5;
      const overlap = [...requiredTokens].filter((token) => tokens(doc.label).has(token));
      score += overlap.length * 2;
      return { doc, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.doc ?? null;
}

export function planKitAttachments(
  required: Array<{ label: string; required: boolean }>,
  vault: VaultDocument[],
  alreadyAttachedIds: Set<string>,
): Array<{ requiredLabel: string; document: VaultDocument }> {
  const used = new Set(alreadyAttachedIds);
  const matches: Array<{ requiredLabel: string; document: VaultDocument }> = [];
  const ordered = [...required].sort((a, b) => Number(b.required) - Number(a.required));
  for (const item of ordered) {
    const attachedVault = vault.filter((doc) => used.has(doc.id));
    if (requiredDocumentCovered(item.label, attachedVault)) continue;
    const match = matchVaultDocument(item.label, vault, used);
    if (!match) continue;
    used.add(match.id);
    matches.push({ requiredLabel: item.label, document: match });
  }
  return matches;
}

export function kitStatus(input: {
  displayName: string | null | undefined;
  university: string | null | undefined;
  educationSummary: string | null | undefined;
  documents: Array<{ type: string; label: string }>;
}): KitStatus {
  const hasName = Boolean(input.displayName?.trim());
  const hasUniversity = Boolean(input.university?.trim());
  const hasEducation = Boolean(input.educationSummary?.trim()) || hasUniversity;
  const hasResume = input.documents.some((doc) => classifyVaultDocument(doc) === "resume");
  const hasIdentityDocument = input.documents.some((doc) => classifyVaultDocument(doc) === "identity_document");
  const hasFamilyDocument = input.documents.some((doc) => classifyVaultDocument(doc) === "family_document");
  const missing: string[] = [];
  if (!hasName) missing.push("name");
  if (!hasUniversity) missing.push("university");
  if (!hasEducation) missing.push("education");
  if (!hasResume) missing.push("resume");
  if (!hasIdentityDocument) missing.push("CNIC");
  if (!hasFamilyDocument) missing.push("B-form");
  return {
    hasName,
    hasUniversity,
    hasEducation,
    hasResume,
    hasIdentityDocument,
    hasFamilyDocument,
    ready: hasName && hasResume,
    missing,
  };
}

export type PendingPacketInput = {
  status: string;
  deadlineAt: string | null;
  hasCaptcha: boolean;
  hasSignature: boolean;
  hasPayment: boolean;
  identityPresent: boolean;
  missingRequiredDocuments: string[];
  questionsWithoutPacketText: number;
  suggestionCount: number;
  prepareAndSendIfSilent: boolean;
};

const CLOSED = new Set(["submitted", "rejected", "withdrawn", "archived", "offer", "accepted"]);

export function classifyPendingPacket(input: PendingPacketInput): PacketLane {
  if (CLOSED.has(input.status)) return "watching";
  if (input.hasCaptcha || input.hasSignature || input.hasPayment) return "waiting_host";
  const blocked =
    !input.identityPresent ||
    input.missingRequiredDocuments.length > 0 ||
    input.questionsWithoutPacketText > 0;
  if (blocked) return "needs_you";
  if (input.prepareAndSendIfSilent && input.deadlineAt) return "sends_at_deadline";
  if (input.suggestionCount > 0) return "needs_you";
  return "watching";
}

export function packetSummary(input: {
  attachedCount: number;
  requiredCount: number;
  questionCount: number;
  packetAnswerCount: number;
  suggestionCount: number;
}): string {
  const docs =
    input.requiredCount === 0
      ? `${input.attachedCount} document${input.attachedCount === 1 ? "" : "s"} attached`
      : `${input.attachedCount}/${input.requiredCount} required documents attached`;
  const answers =
    input.questionCount === 0
      ? "no questions extracted"
      : `${input.packetAnswerCount}/${input.questionCount} answers in the packet`;
  const suggestions =
    input.suggestionCount > 0
      ? ` ${input.suggestionCount} suggestion${input.suggestionCount === 1 ? "" : "s"} still editable.`
      : "";
  return `${docs}; ${answers}.${suggestions}`;
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !STOP.has(token)),
  );
}
