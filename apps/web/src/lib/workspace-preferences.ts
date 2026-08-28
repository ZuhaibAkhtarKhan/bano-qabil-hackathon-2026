export type WorkspacePreferences = {
  onboardingSkippedDocuments: boolean;
  onboardingSkippedProfile: boolean;
  prepareAndSendIfSilent: boolean;
  university: string;
  educationSummary: string;
  guideDismissed: boolean;
};

export function parseWorkspacePreferences(raw: Record<string, unknown> | null | undefined): WorkspacePreferences {
  const value = raw ?? {};
  return {
    onboardingSkippedDocuments: value.onboardingSkippedDocuments === true,
    onboardingSkippedProfile: value.onboardingSkippedProfile === true,
    prepareAndSendIfSilent: value.prepareAndSendIfSilent === true,
    university: typeof value.university === "string" ? value.university.trim() : "",
    educationSummary: typeof value.educationSummary === "string" ? value.educationSummary.trim() : "",
    guideDismissed: value.guideDismissed === true,
  };
}

export function mergeWorkspacePreferences(
  raw: Record<string, unknown> | null | undefined,
  patch: Partial<WorkspacePreferences>,
): Record<string, unknown> {
  const current = parseWorkspacePreferences(raw);
  return {
    ...(raw ?? {}),
    ...current,
    ...patch,
  };
}
