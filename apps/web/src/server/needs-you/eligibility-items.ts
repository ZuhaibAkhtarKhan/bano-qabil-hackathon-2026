import { classifyRequiredDocumentLabel } from "@1apply/domain";
import { isMachineFieldToken } from "@1apply/form-engine";

import {
  detectProfileMemoryField,
  isStructuredFormFieldPrompt,
  needsYouInputType,
  type NeedsYouInputType,
  type NeedsYouItem,
} from "@/lib/needs-you";
import {
  inputTypeFromHostFieldType,
  normalizeNeedsYouFieldType,
  resolveNeedsYouChoiceOptions,
} from "@/lib/needs-you-field-kinds";
import {
  defaultProfileCandidates,
  resolveEligibilityActionTargets,
  type EligibilityCandidate,
  type EligibilityGap,
} from "@/server/needs-you/resolve-eligibility-actions-ai";
import { verifyEligibilityFromMemory } from "@/server/needs-you/verify-eligibility-from-memory";

import type { NeedsYouRawContext } from "./raw-context";

type EligibilityJob = {
  applicationId: string;
  base: {
    applicationId: string;
    applicationHref: string;
    company: string;
    role: string;
  };
  gaps: EligibilityGap[];
  appQuestions: NeedsYouRawContext["questions"];
};

export async function buildEligibilityNeedsYouItems(
  ctx: NeedsYouRawContext,
  job: EligibilityJob,
): Promise<NeedsYouItem[]> {
  const {
    user,
    supabase,
    actor,
    fieldMappings,
    latestAnswerByQuestion,
    recommendedResumeByApp,
    vaultResumes,
  } = ctx;
  const { applicationId, base, gaps: initialGaps, appQuestions } = job;
  let gaps = initialGaps;

  const memoryCheck = await verifyEligibilityFromMemory(supabase, actor, applicationId, gaps);
  gaps = memoryCheck.remaining;

  if (gaps.length === 0) {
    return [];
  }

  const items: NeedsYouItem[] = [];
  const candidates: EligibilityCandidate[] = [...defaultProfileCandidates()];
  const seenCandidate = new Set(candidates.map((c) => c.id));

  for (const mapping of fieldMappings.filter((row) => String(row.application_id) === applicationId)) {
    const label = String(mapping.label || mapping.field_key || "").trim();
    if (!label || isMachineFieldToken(label)) continue;
    const id = `mapping:${mapping.id}`;
    if (seenCandidate.has(id)) continue;
    seenCandidate.add(id);
    candidates.push({
      id,
      kind: "mapping",
      label,
      currentValue: String(mapping.value ?? "").trim() || null,
      mappingId: String(mapping.id),
      profileField: detectProfileMemoryField(label),
    });
  }

  for (const question of appQuestions) {
    const prompt = String(question.prompt ?? "").trim();
    if (!prompt || isStructuredFormFieldPrompt(prompt)) continue;
    const id = `question:${question.id}`;
    if (seenCandidate.has(id)) continue;
    seenCandidate.add(id);
    const answer = latestAnswerByQuestion.get(`${applicationId}:${question.id}`);
    candidates.push({
      id,
      kind: "question",
      label: prompt,
      currentValue: String(answer?.approved_text || answer?.user_edited_text || "").trim() || null,
      questionId: String(question.id),
      answerId: answer ? String(answer.id) : null,
    });
  }

  const { targets, unresolvedGaps } = await resolveEligibilityActionTargets({ gaps, candidates });
  const targetedGapIds = new Set(targets.map((target) => target.gapId));
  if (targetedGapIds.size > 0) {
    await supabase
      .from("eligibility_results")
      .update({ ack_only: false })
      .eq("user_id", user.id)
      .in("id", [...targetedGapIds]);
  }
  if (unresolvedGaps.length > 0) {
    await supabase
      .from("eligibility_results")
      .update({ ack_only: true })
      .eq("user_id", user.id)
      .in(
        "id",
        unresolvedGaps.map((gap) => gap.id),
      );
  }

  const seenTarget = new Set<string>();
  const mappingById = new Map(
    fieldMappings
      .filter((row) => String(row.application_id) === applicationId)
      .map((row) => [String(row.id), row] as const),
  );

  for (const target of targets) {
    const dedupeKey = `${target.gapId}:${target.id}`;
    if (seenTarget.has(dedupeKey)) continue;
    seenTarget.add(dedupeKey);
    const gap = gaps.find((g) => g.id === target.gapId);
    const issue =
      gap?.explanation ||
      target.reason ||
      "Eligibility needs confirmation before this application can continue.";
    const requirement = gap?.requirementText || null;
    const linkedMapping = target.mappingId ? mappingById.get(target.mappingId) : undefined;
    const linkedFieldType = linkedMapping
      ? normalizeNeedsYouFieldType(
          typeof linkedMapping.field_type === "string" ? linkedMapping.field_type : null,
        )
      : null;
    const resumeOrFileTarget =
      linkedFieldType === "file" ||
      classifyRequiredDocumentLabel(target.label) === "resume" ||
      /\b(upload|attach).{0,40}\b(resume|cv)\b|\b(resume|cv)\b.{0,20}\b(upload|attach)\b/i.test(
        target.label,
      );

    if (resumeOrFileTarget) {
      const recommended =
        recommendedResumeByApp.get(applicationId) ??
        (vaultResumes[0]
          ? {
              documentId: vaultResumes[0].id,
              label: vaultResumes[0].label,
              score: null as number | null,
              suggestion: null as string | null,
              weakFit: false,
            }
          : null);
      items.push({
        ...base,
        id: `eligibility:${applicationId}:${target.gapId}:${target.id}`,
        kind: "eligibility",
        title: target.label,
        detail: target.reason,
        inputLabel: "Attach a resume from Application Memory",
        inputType: "document",
        required: true,
        payload: {
          eligibilityId: target.gapId,
          mappingId: target.mappingId,
          questionId: target.questionId,
          answerId: target.answerId,
          profileField: target.profileField ?? detectProfileMemoryField(target.label),
          requiredLabel: target.label,
          uploadKind: "document",
          documentStatus: vaultResumes.length === 0 ? "unavailable" : recommended?.weakFit ? "not_best_fit" : "attach",
          recommendedDocumentId: recommended?.documentId ?? null,
          recommendedDocumentLabel: recommended?.label ?? null,
          fitScore: typeof recommended?.score === "number" ? recommended.score : null,
          fitSuggestion: recommended?.suggestion ?? null,
          eligibilityIssue: issue,
          eligibilityRequirement: requirement,
          allowDeleteApplication: true,
          currentValue: target.currentValue ?? null,
        },
      });
      continue;
    }

    const choiceOptions = resolveNeedsYouChoiceOptions({
      label: target.label,
      fieldType: linkedFieldType,
      mappingOptions: linkedMapping?.options,
    });
    const hostInputType = inputTypeFromHostFieldType(
      linkedFieldType,
      target.label,
      choiceOptions.length,
    );
    const inputType: NeedsYouInputType =
      hostInputType === "multi-select" && choiceOptions.length > 0
        ? "multi-select"
        : hostInputType === "select" && choiceOptions.length > 0
          ? "select"
          : hostInputType && hostInputType !== "select" && hostInputType !== "multi-select"
            ? hostInputType
            : choiceOptions.length > 1
              ? "multi-select"
              : choiceOptions.length > 0
                ? "select"
                : needsYouInputType(target.label, "eligibility");

    items.push({
      ...base,
      id: `eligibility:${applicationId}:${target.gapId}:${target.id}`,
      kind: "eligibility",
      title: target.label,
      detail: target.reason,
      inputLabel:
        inputType === "multi-select"
          ? "Choose all that apply"
          : inputType === "select"
            ? "Choose an option"
            : "Updated answer",
      inputType,
      required: true,
      options:
        inputType === "select" || inputType === "multi-select" ? choiceOptions : undefined,
      payload: {
        eligibilityId: target.gapId,
        mappingId: target.mappingId,
        questionId: target.questionId,
        answerId: target.answerId,
        profileField: target.profileField ?? detectProfileMemoryField(target.label),
        requiredLabel: target.label,
        eligibilityIssue: issue,
        eligibilityRequirement: requirement,
        allowDeleteApplication: true,
        currentValue: target.currentValue ?? null,
      },
    });
  }

  for (const gap of unresolvedGaps) {
    const needsAck = gap.state !== "not_met";
    items.push({
      ...base,
      id: `eligibility:${applicationId}:${gap.id}:unresolved`,
      kind: "eligibility",
      title: gap.requirementText || "Eligibility requirement",
      detail: needsAck
        ? "This requirement may block the application. Confirm you are eligible, or remove the application if you are not."
        : "Application Memory does not support this requirement. Remove the application if you are not eligible.",
      inputLabel: needsAck ? "Confirm eligibility" : "Eligibility",
      inputType: "text",
      required: true,
      payload: {
        eligibilityId: gap.id,
        eligibilityIssue: gap.explanation,
        eligibilityRequirement: gap.requirementText,
        allowDeleteApplication: true,
        confirmEligible: needsAck,
      },
    });
  }

  return items;
}

export type { EligibilityJob };
