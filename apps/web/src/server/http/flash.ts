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
  kit_updated: "Your kit was updated from this document. Review Personal and Skills to confirm.",
  kit_updated_partial:
    "Your kit was partially updated. Some fields could not be matched automatically — review the remaining blanks.",
  kit_fill_failed:
    "Text was extracted, but Your kit could not be auto-filled. Check your AI settings or fill fields manually.",
  stored_only: "Document stored for applications. Your kit was not changed.",
  document_processing:
    "File uploaded. Text extraction and Your kit update are running in the background — we'll notify you when done.",
  opportunity_created: "Opportunity saved. Review the structured analysis before applying.",
  analyzing: "Opportunity fetched. Structured analysis is running — review the detail page.",
  duplicate_opportunity: "This website is already added. Opening the existing opportunity.",
  discovery_ready: "Discovery ranked sourced listings. Save one to run the normal opportunity pipeline.",
  checks_ran: "Automation checks ran. Notices are user-scoped, idempotent for today, and nothing was submitted for you.",
  discovery_queued: "Discovery ranked sourced listings. Save one to run the normal opportunity pipeline.",
  fetch_failed: "That page could not be fetched. The URL was saved — paste the posting text to continue analysis.",
  pasted: "Pasted text saved. Structured analysis is running.",
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
  application_deleted: "Application and its saved posting were removed.",
  document_deleted: "Document deleted. Extracted memory from that file was removed too.",
  version_deleted: "Version removed from your vault.",
  conflict_resolved: "Conflict resolved. The chosen value is verified; other sources were rejected.",
  conflict_detected: "New facts were extracted. Review conflicts before verifying.",
  version_selected: "Selected version is now the latest for this document.",
  submission_blocked: "Submission blocked. See the checklist for blocking issues.",
  duplicate_prevented: "Duplicate submission prevented. An identical snapshot already exists.",
  continued:
    "Saved to Application Memory. That application is continuing in the background with the new information.",
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
