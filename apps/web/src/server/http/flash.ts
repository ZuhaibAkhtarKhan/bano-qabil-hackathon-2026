import { redirect } from "next/navigation";

export const FLASH = {
  saved: "Saved.",
  evidence_added: "Evidence added as unverified. Confirm it before generation can use it.",
  verified: "Evidence verified. Generation may use it unless you exclude it.",
  excluded: "Evidence excluded from AI.",
  included: "Evidence included for AI again.",
  uploaded: "Document stored in your private vault.",
  extracted: "Text extracted. Review proposed evidence before verifying.",
  binary_stored:
    "File stored, but no extractable text was found (encrypted PDF, scan-only, or unsupported encoding). Add evidence from it yourself.",
  duplicate_file: "That file is already in your vault.",
  opportunity_created: "Opportunity saved. Review the structured analysis before applying.",
  analyzing: "Opportunity fetched. Structured analysis is running — review the detail page.",
  duplicate_opportunity: "That URL is already in your workspace. Opening the existing opportunity.",
  discovery_ready: "Discovery ranked sourced listings. Save one to run the normal opportunity pipeline.",
  checks_ran: "Automation checks ran. Notices are user-scoped, idempotent for today, and nothing was submitted for you.",
  discovery_queued: "Discovery request recorded. External matching will plug into this pipeline.",
  analyzed: "Analysis refreshed.",
  fit_analyzed: "Eligibility and Fit Index refreshed from verified evidence only.",
  drafted: "Draft stored. Review citations before you approve.",
  no_evidence: "No verified evidence matched this question. Nothing was invented.",
  ai_unavailable: "No AI provider is configured. Write from verified evidence yourself.",
  approved: "Answer approved. Editing later creates a new version.",
  attached: "Document version attached to this application.",
  submitted: "Submission snapshot frozen. 1-Apply did not send this to the host.",
  already_submitted: "This application already has a frozen snapshot.",
  status_updated: "Application status updated.",
  deleted: "Removed from Application Memory.",
  conflict_resolved: "Conflict resolved. The chosen value is verified; other sources were rejected.",
  conflict_detected: "New facts were extracted. Review conflicts before verifying.",
  version_selected: "Selected version is now the latest for this document.",
  submission_blocked: "Submission blocked. See the checklist for blocking issues.",
  duplicate_prevented: "Duplicate submission prevented. An identical snapshot already exists.",
} as const;

export const ERRORS = {
  required: "Fill in the required fields.",
  save: "Could not save. Try again.",
  unsafe_url: "Only public http(s) URLs can be ingested.",
  page_fetch: "That page could not be fetched safely.",
  upload: "Upload failed. Check the file type and size (8 MB max).",
  not_found: "That record was not found.",
  grounding: "The draft was rejected because it was not grounded in verified evidence.",
  snapshot: "Could not freeze a snapshot.",
} as const;

export type FlashCode = keyof typeof FLASH;
export type ErrorCode = keyof typeof ERRORS;

export function redirectWith(
  path: string,
  query: { notice?: FlashCode; error?: ErrorCode } = {},
  hash?: string,
): never {
  const params = new URLSearchParams();
  if (query.notice) params.set("notice", query.notice);
  if (query.error) params.set("error", query.error);
  const search = params.toString();
  redirect(`${path}${search ? `?${search}` : ""}${hash ? `#${hash}` : ""}`);
}
