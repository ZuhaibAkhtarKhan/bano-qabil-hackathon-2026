/**
 * Shared application fill lifecycle — single source of truth for status /
 * next_action strings used by extension fill, Need You, dashboard, and
 * background submission probing.
 *
 * Dependency map (do not invent parallel status strings elsewhere):
 *
 *   Extension SAVE
 *     → ingest → ensureApplication (saved)
 *     → analyze job
 *
 *   Extension FILL
 *     → POST fill-plan → markFillStarted (in_progress + FILLING)
 *
 *   Extension STOP / tab close / leave origin
 *     → CAPTURE_FILLED_STATE
 *     → POST fill-session/end (stopped|tab_closed|origin_left)
 *         → persist field values into Application Memory + field_mappings
 *         → markFillStopped (in_progress|review_required + STOPPED_* / NEEDS_YOU)
 *         → continueApplicationAfterFillStop (eligibility + answer regen)
 *         → Need You queue reads empty/low-confidence mappings + gaps
 *         → Realtime on applications row refreshes dashboard Status
 *
 *   Host submit (EC2 Playwright)
 *     → click Submit + host confirmation (formResponse / thank-you)
 *     → status submitted + SUBMITTED
 *
 *   Freeze snapshot / page-text probe must NOT set submitted.
 *
 * If you change a next_action constant here, update:
 *   - lib/dashboard-display.ts (Status column filters/labels)
 *   - server/needs-you/queries.ts (active pipeline)
 *   - server/applications/fill-lifecycle.ts (writers)
 *   - extension stop/end callers
 */

export const FILL_SESSION_END_REASONS = [
  "stopped",
  "tab_closed",
  "origin_left",
  "submitted_detected",
] as const;

export type FillSessionEndReason = (typeof FILL_SESSION_END_REASONS)[number];

/** Canonical next_action copy — keep dashboard + Need You regexes in sync. */
export const APPLICATION_LIFECYCLE_ACTIONS = {
  FILLING: "Filling form fields from Application Memory",
  STOPPED_CONTINUING:
    "Stopped on the form — continuing from Application Memory in the background",
  NEEDS_YOU:
    "Needs you — missing fields Application Memory cannot answer yet",
  SUBMITTED: "Submitted — monitoring host for updates",
  ANALYZED: "Review analyzed requirements and verify eligibility",
} as const;

export type ApplicationLifecycleAction =
  (typeof APPLICATION_LIFECYCLE_ACTIONS)[keyof typeof APPLICATION_LIFECYCLE_ACTIONS];
