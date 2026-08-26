/**
 * Host-page copy that means the application was already accepted / submitted.
 * Used by the web app background probe (and optional extension pageText).
 * The extension does not need to decide status — the web app is source of truth.
 */
const SUBMITTED_PATTERNS: RegExp[] = [
  /already\s+submitted/i,
  /already\s+applied/i,
  /application\s+already\s+(received|submitted|on\s+file)/i,
  /response\s+(has\s+been\s+)?recorded/i,
  /response\s+already\s+recorded/i,
  /thank\s+you\s+for\s+(your\s+)?(application|applying|submitting)/i,
  /application\s+(has\s+been\s+)?(received|submitted|sent)/i,
  /we\s+have\s+received\s+your\s+application/i,
  /your\s+application\s+was\s+submitted/i,
  /submission\s+(was\s+)?successful/i,
  /successfully\s+submitted/i,
  /applied\s+with\s+this\s+email/i,
  /you\s+have\s+already\s+applied/i,
  /duplicate\s+application/i,
];

export type SubmissionSignalResult = {
  submitted: boolean;
  matchedPattern: string | null;
  snippet: string | null;
};

export function detectSubmissionSignals(pageText: string | null | undefined): SubmissionSignalResult {
  const text = (pageText ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return { submitted: false, matchedPattern: null, snippet: null };
  }

  for (const pattern of SUBMITTED_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const index = Math.max(0, (match.index ?? 0) - 40);
    return {
      submitted: true,
      matchedPattern: pattern.source,
      snippet: text.slice(index, index + 160),
    };
  }

  return { submitted: false, matchedPattern: null, snippet: null };
}
