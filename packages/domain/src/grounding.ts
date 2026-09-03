import {
  assertDraftIsGrounded,
  type BatchFieldResult,
  type GroundedDraft,
} from "@1apply/contracts";

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

function needYouField(fieldId: string, extra?: Partial<BatchFieldResult>): BatchFieldResult {
  return {
    fieldId,
    status: "need_you",
    ...extra,
    value: undefined,
    evidenceIds: undefined,
    documentVersionId: undefined,
  };
}

/**
 * Strip unknown evidence / document IDs from a batch fill response.
 * Unknown citations are dropped; a field with no remaining owned/verified
 * grounding is forced to `need_you` (same rule as finalizeGroundedDraft).
 */
export function groundBatchFillFields(input: {
  fields: BatchFieldResult[];
  allowedEvidenceIds: string[];
  allowedDocumentVersionIds: string[];
  /** Required sole confirmations (privacy / record email) — not invented facts. */
  formRequirementFieldIds?: string[];
}): BatchFieldResult[] {
  const allowedEvidence = new Set(input.allowedEvidenceIds);
  const allowedDocuments = new Set(input.allowedDocumentVersionIds);
  const formRequirement = new Set(input.formRequirementFieldIds ?? []);

  return input.fields.map((field) => {
    if (field.status !== "filled") {
      return needYouField(field.fieldId);
    }

    if (formRequirement.has(field.fieldId) && (field.value ?? "").trim()) {
      return {
        fieldId: field.fieldId,
        status: "filled",
        value: field.value,
      };
    }

    const cited = field.evidenceIds ?? [];
    const documentVersionId =
      field.documentVersionId && allowedDocuments.has(field.documentVersionId)
        ? field.documentVersionId
        : undefined;

    if (documentVersionId) {
      const evidenceIds = cited.filter((id) => allowedEvidence.has(id));
      return {
        fieldId: field.fieldId,
        status: "filled",
        documentVersionId,
        ...(evidenceIds.length ? { evidenceIds } : {}),
      };
    }

    const value = (field.value ?? "").trim();
    // Profile / kit / stored mapping fills are verified user data — not LLM drafts.
    // Only narrative AI drafts require evidence grounding.
    if (value && cited.length === 0 && field.applyMode !== "ai_assistant") {
      return {
        fieldId: field.fieldId,
        status: "filled",
        value,
        ...(field.reason ? { reason: field.reason } : {}),
        ...(field.applyMode ? { applyMode: field.applyMode } : {}),
      };
    }

    const draft = finalizeGroundedDraft({
      text: field.value ?? "",
      citedIds: cited,
      allowedIds: [...allowedEvidence],
    });

    if (!draft.text) {
      return needYouField(field.fieldId, {
        ...(field.applyMode === "ai_assistant" ? { applyMode: "ai_assistant" as const } : {}),
      });
    }

    return {
      fieldId: field.fieldId,
      status: "filled",
      value: draft.text,
      ...(draft.evidenceIds.length ? { evidenceIds: draft.evidenceIds } : {}),
    };
  });
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
