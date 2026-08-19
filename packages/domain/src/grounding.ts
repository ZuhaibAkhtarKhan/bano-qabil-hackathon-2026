import { assertDraftIsGrounded, type GroundedDraft } from "@1apply/contracts";

export function finalizeGroundedDraft(input: {
  text: string;
  citedIds: string[];
  allowedIds: string[];
  missingFacts?: string[];
  warnings?: string[];
}): GroundedDraft {
  const allowed = new Set(input.allowedIds);
  const evidenceIds = [...new Set(input.citedIds.filter((id) => allowed.has(id)))];
  const warnings = [...(input.warnings ?? [])];
  const missingFacts = [...(input.missingFacts ?? [])];

  if (input.citedIds.some((id) => !allowed.has(id))) {
    warnings.push("UNKNOWN_EVIDENCE_STRIPPED");
  }

  let text = input.text.trim();
  if (text.length > 0 && evidenceIds.length === 0) {
    text = "";
    missingFacts.push("No verified evidence was available to support a draft.");
    warnings.push("NO_EVIDENCE");
  }

  const draft: GroundedDraft = {
    text,
    evidenceIds,
    missingFacts,
    warnings: [...new Set(warnings)],
    characterCount: text.length,
  };

  const issues = assertDraftIsGrounded(draft);
  if (issues.includes("NO_EVIDENCE")) {
    return {
      ...draft,
      text: "",
      characterCount: 0,
      warnings: [...new Set([...draft.warnings, ...issues])],
    };
  }

  return draft;
}

export function lengthWarnings(
  text: string,
  limitValue: number | null,
  limitUnit: string | null,
): string[] {
  if (!limitValue || limitValue <= 0) return [];
  const unit = (limitUnit ?? "characters").toLowerCase();
  if (unit.startsWith("word")) {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return words > limitValue ? ["LENGTH_EXCEEDED"] : [];
  }
  return text.length > limitValue ? ["LENGTH_EXCEEDED"] : [];
}

export function freezeSubmissionManifest(input: {
  answers: Array<{ questionId: string; answerVersionId: string; prompt?: string; text?: string }>;
  documents: Array<{ documentId: string; documentVersionId: string; label?: string }>;
}) {
  return {
    submittedAt: new Date().toISOString(),
    answerManifest: input.answers.map((item) => ({
      questionId: item.questionId,
      answerVersionId: item.answerVersionId,
      prompt: item.prompt ?? "",
      text: item.text ?? "",
    })),
    documentManifest: input.documents.map((item) => ({
      documentId: item.documentId,
      documentVersionId: item.documentVersionId,
      label: item.label ?? "",
    })),
  };
}
