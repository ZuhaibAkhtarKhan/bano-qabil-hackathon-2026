import {
  classifyRequiredDocumentLabel,
  packetAnswerText,
  requiredDocumentCovered,
} from "@1apply/domain";

import type { DashboardDocStatus } from "@/lib/dashboard-display";

export type TrackerVaultDoc = { type: string; label: string };

function hasText(value: string | null | undefined): boolean {
  return Boolean(String(value ?? "").trim());
}

export function isResumeRequirementLabel(label: string): boolean {
  return classifyRequiredDocumentLabel(label) === "resume";
}

/** Cover letter requirements may appear under several host-form labels. */
export function isCoverRequirementLabel(label: string): boolean {
  if (classifyRequiredDocumentLabel(label) === "cover_letter") return true;
  return /\b(motivation\s*letter|letter\s+of\s+motivation|personal\s+statement)\b/i.test(label);
}

function normalizeAttachedMeta(meta: { label: string; type: string }): TrackerVaultDoc[] {
  const docs: TrackerVaultDoc[] = [{ type: meta.type, label: meta.label || meta.type }];
  if (meta.type === "resume" && !/\bresume\b|\bcv\b/i.test(meta.label)) {
    docs.push({ type: "resume", label: "resume" });
  }
  if (meta.type === "cover_letter" && !isCoverRequirementLabel(meta.label)) {
    docs.push({ type: "cover_letter", label: "cover letter" });
  }
  return docs;
}

export function buildTrackerVaultDocs(input: {
  attachedMeta: Array<{ label: string; type: string }>;
  mappings: Array<{ label: string; value: string; fieldType?: string | null }>;
  answers: Array<{ prompt: string; text: string | null }>;
}): TrackerVaultDoc[] {
  const vault: TrackerVaultDoc[] = [];

  for (const meta of input.attachedMeta) {
    vault.push(...normalizeAttachedMeta(meta));
  }

  for (const mapping of input.mappings) {
    if (!hasText(mapping.value)) continue;
    const label = mapping.label.trim();
    if (!label) continue;
    if (mapping.fieldType === "file" || isResumeRequirementLabel(label) || isCoverRequirementLabel(label)) {
      const kind = classifyRequiredDocumentLabel(label);
      vault.push({
        type: kind === "other" ? (isCoverRequirementLabel(label) ? "cover_letter" : mapping.fieldType ?? "other") : kind,
        label,
      });
    }
  }

  for (const answer of input.answers) {
    if (!hasText(answer.text)) continue;
    const prompt = answer.prompt.trim();
    if (!prompt) continue;
    if (isCoverRequirementLabel(prompt)) {
      vault.push({ type: "cover_letter", label: prompt });
    } else if (isResumeRequirementLabel(prompt)) {
      vault.push({ type: "resume", label: prompt });
    }
  }

  return vault;
}

export function buildTrackerRequiredLabels(input: {
  opportunityDocLabels: string[];
  mappingLabels: string[];
  questionPrompts: Array<{ prompt: string; required?: boolean | null }>;
}): string[] {
  const labels = new Set(input.opportunityDocLabels.map((label) => label.trim()).filter(Boolean));

  for (const label of input.mappingLabels) {
    const trimmed = label.trim();
    if (!trimmed) continue;
    if (isResumeRequirementLabel(trimmed) || isCoverRequirementLabel(trimmed)) {
      labels.add(trimmed);
    }
  }

  for (const question of input.questionPrompts) {
    const prompt = question.prompt.trim();
    if (!prompt) continue;
    if (question.required === false) continue;
    if (isResumeRequirementLabel(prompt) || isCoverRequirementLabel(prompt)) {
      labels.add(prompt);
    }
  }

  return [...labels];
}

export function trackerDocumentStatuses(
  requiredLabels: string[],
  vault: TrackerVaultDoc[],
): { resume: DashboardDocStatus; cover: DashboardDocStatus } {
  const resumeRequirements = requiredLabels.filter(isResumeRequirementLabel);
  const coverRequirements = requiredLabels.filter(isCoverRequirementLabel);

  const resumeReady =
    resumeRequirements.length > 0 &&
    resumeRequirements.some((label) => requiredDocumentCovered(label, vault));
  const coverReady =
    coverRequirements.length > 0 &&
    coverRequirements.some((label) => requiredDocumentCovered(label, vault));

  return {
    resume: resumeRequirements.length === 0 ? "Not required" : resumeReady ? "Ready" : "Missing",
    cover: coverRequirements.length === 0 ? "Not required" : coverReady ? "Ready" : "Missing",
  };
}

export function answerTextForTracker(answer: {
  approved_text?: string | null;
  user_edited_text?: string | null;
  original_ai_text?: string | null;
} | null | undefined): string | null {
  if (!answer) return null;
  return packetAnswerText({
    approvedText: answer.approved_text ?? null,
    userEditedText: answer.user_edited_text ?? null,
    originalAiText: answer.original_ai_text ?? null,
  });
}
