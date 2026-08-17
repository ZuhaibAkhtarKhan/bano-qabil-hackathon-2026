export type SemanticStatus =
  | "verified"
  | "ai_generated"
  | "user_edited"
  | "needs_review"
  | "conflict"
  | "unknown"
  | "approved"
  | "rejected"
  | "processing"
  | "failed";

export type StatusTone = "mint" | "teal" | "violet" | "coral" | "sand" | "muted";

export const SEMANTIC_STATUS: Record<
  SemanticStatus,
  { label: string; tone: StatusTone; pattern: "solid" | "dashed"; description: string }
> = {
  verified: {
    label: "Verified",
    tone: "mint",
    pattern: "solid",
    description: "Confirmed by you. Eligible for generation.",
  },
  ai_generated: {
    label: "AI generated",
    tone: "violet",
    pattern: "dashed",
    description: "Model draft. Not the same as verified evidence.",
  },
  user_edited: {
    label: "User edited",
    tone: "teal",
    pattern: "solid",
    description: "You changed this after generation.",
  },
  needs_review: {
    label: "Needs review",
    tone: "sand",
    pattern: "solid",
    description: "Waiting for your decision.",
  },
  conflict: {
    label: "Conflict",
    tone: "coral",
    pattern: "solid",
    description: "Two sources disagree. Nothing was auto-resolved.",
  },
  unknown: {
    label: "Unknown",
    tone: "muted",
    pattern: "solid",
    description: "Not enough verified evidence to decide.",
  },
  approved: {
    label: "Approved",
    tone: "mint",
    pattern: "solid",
    description: "You approved this version.",
  },
  rejected: {
    label: "Rejected",
    tone: "coral",
    pattern: "solid",
    description: "Rejected or excluded.",
  },
  processing: {
    label: "Processing",
    tone: "sand",
    pattern: "solid",
    description: "A job is running.",
  },
  failed: {
    label: "Failed",
    tone: "coral",
    pattern: "solid",
    description: "The last job failed.",
  },
};

export function evidenceSemanticStatus(input: {
  verificationStatus: "unverified" | "verified" | "rejected";
  excludedFromAi?: boolean;
  extractionStatus?: "manual" | "extracted" | "user_edited";
  hasOpenConflict?: boolean;
}): SemanticStatus {
  if (input.hasOpenConflict) return "conflict";
  if (input.excludedFromAi) return "rejected";
  if (input.verificationStatus === "verified") return "verified";
  if (input.verificationStatus === "rejected") return "rejected";
  if (input.extractionStatus === "extracted") return "ai_generated";
  if (input.extractionStatus === "user_edited") return "user_edited";
  return "needs_review";
}

export function factSemanticStatus(input: {
  verificationStatus: "unverified" | "verified" | "rejected";
  extractionStatus: "manual" | "extracted" | "user_edited";
  hasOpenConflict?: boolean;
}): SemanticStatus {
  if (input.hasOpenConflict) return "conflict";
  if (input.verificationStatus === "verified") return "verified";
  if (input.verificationStatus === "rejected") return "rejected";
  if (input.extractionStatus === "extracted") return "ai_generated";
  if (input.extractionStatus === "user_edited") return "user_edited";
  return "needs_review";
}

export function answerSemanticStatus(input: {
  approved: boolean;
  model: string | null;
  text: string;
}): SemanticStatus {
  if (input.approved) return "approved";
  if (!input.text.trim()) return "unknown";
  if (input.model) return "ai_generated";
  return "user_edited";
}
