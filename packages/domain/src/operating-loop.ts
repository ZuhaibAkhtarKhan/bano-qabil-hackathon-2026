export const OPERATING_LOOP_STAGES = [
  "create",
  "find_save",
  "analyze",
  "eligibility",
  "fit",
  "match",
  "generate",
  "review",
  "autofill",
  "apply",
  "track",
  "email",
  "calendar",
  "remember",
  "next",
] as const;

export type OperatingLoopStage = (typeof OPERATING_LOOP_STAGES)[number];

export type OperatingLoopSnapshot = {
  hasOpportunity: boolean;
  opportunityAnalyzed: boolean;
  hasEligibility: boolean;
  hasFit: boolean;
  hasResumeMatch: boolean;
  hasGeneratedAnswer: boolean;
  hasApprovedAnswer: boolean;
  hasAutofillMapping: boolean;
  hasSubmissionSnapshot: boolean;
  hasTrackingEvent: boolean;
  hasEmailEvent: boolean;
  hasCalendarEvent: boolean;
  hasVerifiedMemory: boolean;
  hasNextApplication: boolean;
};

export type LoopStageResult = {
  id: OperatingLoopStage;
  label: string;
  done: boolean;
  detail: string;
};

const LABELS: Record<OperatingLoopStage, string> = {
  create: "Create",
  find_save: "Find / save",
  analyze: "Analyze",
  eligibility: "Eligibility",
  fit: "Fit",
  match: "Match",
  generate: "Generate",
  review: "Review",
  autofill: "Autofill",
  apply: "Apply",
  track: "Track",
  email: "Email",
  calendar: "Calendar",
  remember: "Remember",
  next: "Next application",
};

export function assessOperatingLoop(snapshot: OperatingLoopSnapshot): LoopStageResult[] {
  const stages: Array<{ id: OperatingLoopStage; done: boolean; detail: string }> = [
    { id: "create", done: snapshot.hasOpportunity, detail: snapshot.hasOpportunity ? "Opportunity exists." : "Save or discover an opportunity first." },
    { id: "find_save", done: snapshot.hasOpportunity, detail: snapshot.hasOpportunity ? "Saved into the same opportunity table." : "Discovery and paste both write opportunities." },
    { id: "analyze", done: snapshot.opportunityAnalyzed, detail: snapshot.opportunityAnalyzed ? "Requirements extracted." : "Run analysis so later stages have structure." },
    { id: "eligibility", done: snapshot.hasEligibility, detail: snapshot.hasEligibility ? "Eligibility verdicts stored." : "Analyze the application against verified memory." },
    { id: "fit", done: snapshot.hasFit, detail: snapshot.hasFit ? "Fit Index stored." : "Fit runs after eligibility, from the same evidence." },
    { id: "match", done: snapshot.hasResumeMatch, detail: snapshot.hasResumeMatch ? "Resume ranking stored." : "Resume match uses the analyzed opportunity text." },
    { id: "generate", done: snapshot.hasGeneratedAnswer, detail: snapshot.hasGeneratedAnswer ? "A grounded draft exists." : "Generate from ranked evidence, not from the posting alone." },
    { id: "review", done: snapshot.hasApprovedAnswer, detail: snapshot.hasApprovedAnswer ? "An answer is approved." : "Approve drafts before they can enter a snapshot." },
    { id: "autofill", done: snapshot.hasAutofillMapping, detail: snapshot.hasAutofillMapping ? "Field mappings recorded." : "Autofill stays preview-first and optional." },
    { id: "apply", done: snapshot.hasSubmissionSnapshot, detail: snapshot.hasSubmissionSnapshot ? "Snapshot frozen. Host submit is still yours." : "Freeze a snapshot when the checklist is clear." },
    { id: "track", done: snapshot.hasTrackingEvent, detail: snapshot.hasTrackingEvent ? "Status or application events recorded." : "Status changes write the shared timeline." },
    { id: "email", done: snapshot.hasEmailEvent, detail: snapshot.hasEmailEvent ? "An application email is associated." : "Gmail sync classifies mail onto this application." },
    { id: "calendar", done: snapshot.hasCalendarEvent, detail: snapshot.hasCalendarEvent ? "A calendar event is linked." : "Interview mail can propose a calendar event." },
    { id: "remember", done: snapshot.hasVerifiedMemory, detail: snapshot.hasVerifiedMemory ? "Verified memory is available for the next loop." : "Verify evidence so the next application can reuse it." },
    { id: "next", done: snapshot.hasNextApplication, detail: snapshot.hasNextApplication ? "Another application is already in the workspace." : "Start the next opportunity from the same memory." },
  ];

  return stages.map((stage) => ({ ...stage, label: LABELS[stage.id] }));
}

export function loopContinuity(results: LoopStageResult[]): { brokenAt: OperatingLoopStage | null; connected: boolean } {
  const firstGap = results.find((stage) => !stage.done && stage.id !== "email" && stage.id !== "calendar" && stage.id !== "autofill" && stage.id !== "next");
  return { brokenAt: firstGap?.id ?? null, connected: !firstGap };
}
