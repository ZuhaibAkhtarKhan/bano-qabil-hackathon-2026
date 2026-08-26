export type WorkspacePreferences = {
  onboardingSkippedDocuments: boolean;
  prepareAndSendIfSilent: boolean;
  university: string;
  educationSummary: string;
};

export function parseWorkspacePreferences(raw: Record<string, unknown> | null | undefined): WorkspacePreferences {
  const value = raw ?? {};
  return {
    onboardingSkippedDocuments: value.onboardingSkippedDocuments === true,
    prepareAndSendIfSilent: value.prepareAndSendIfSilent === true,
    university: typeof value.university === "string" ? value.university.trim() : "",
    educationSummary: typeof value.educationSummary === "string" ? value.educationSummary.trim() : "",
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
