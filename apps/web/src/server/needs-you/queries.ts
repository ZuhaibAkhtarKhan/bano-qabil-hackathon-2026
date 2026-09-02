import { humanQuestionLabel, humanizeFieldToken, isMachineFieldToken } from "@1apply/form-engine";
import {
  classifyRequiredDocumentLabel,
  matchVaultDocument,
  requiredDocumentCovered,
} from "@1apply/domain";
import { cache } from "react";

import { sourceLabelFromOpportunity } from "@/lib/dashboard-display";
import {
  detectProfileMemoryField,
  isNeedsYouSystemNoise,
  isStructuredFormFieldPrompt,
  needsYouInputType,
  compareNeedsYouItems,
  dedupeNeedsYouItems,
  type NeedsYouInputType,
  type NeedsYouItem,
} from "@/lib/needs-you";
import {
  inputTypeFromHostFieldType,
  isChoiceFieldType,
  isImageUploadRequest,
  normalizeNeedsYouFieldType,
  resolveNeedsYouChoiceOptions,
} from "@/lib/needs-you-field-kinds";
import { polishFormQuestionLabels } from "@/server/needs-you/polish-labels";
import { buildEligibilityNeedsYouItems, type EligibilityJob } from "@/server/needs-you/eligibility-items";
import { markEligibilityAckOnly } from "@/server/needs-you/confirm-eligibility";
import { loadNeedsYouRawContext } from "@/server/needs-you/raw-context";
import type { EligibilityGap } from "@/server/needs-you/resolve-eligibility-actions-ai";
import { verifyEligibilityFromMemory } from "@/server/needs-you/verify-eligibility-from-memory";
import { asOne } from "@/server/types";

function oppMeta(row: {
  opportunities?:
    | { title?: string | null; organization?: string | null; source?: string | null }
    | Array<{ title?: string | null; organization?: string | null; source?: string | null }>
    | null;
}) {
  const opportunity = asOne(row.opportunities);
  return {
    company: opportunity?.organization?.trim() || "Unknown organization",
    role: opportunity?.title?.trim() || "Untitled role",
    sourceLabel: sourceLabelFromOpportunity(opportunity),
  };
}

export type NeedsYouDocumentOption = {
  id: string;
  label: string;
  type: string;
  currentVersionId: string | null;
  versionLabel: string | null;
  categoryLabel: string | null;
  fileName: string | null;
  /** Human-readable dropdown text: name · version · category */
  displayLabel: string;
};

export type NeedsYouWallInfo = {
  captcha: boolean;
  captchaMessage: string | null;
  accountCreation: boolean;
  accountMessage: string | null;
  unsupported: boolean;
  unsupportedReason: string | null;
  originHost: string | null;
};

export type NeedsYouApplicationGroup = {
  applicationId: string;
  href: string;
  company: string;
  role: string;
  initial: string;
  sourceLabel: string | null;
  fieldCount: number;
  walls: NeedsYouWallInfo;
  items: NeedsYouItem[];
};

export type NeedsYouQueue = {
  items: NeedsYouItem[];
  groups: NeedsYouApplicationGroup[];
  documents: NeedsYouDocumentOption[];
  /** Open (non-closed) application ids — used for background resume selection. */
  openApplicationIds: string[];
  counts: {
    total: number;
    byKind: Record<string, number>;
  };
};

export function countsFromNeedsYouQueue(queue: NeedsYouQueue): {
  applicationCount: number;
  totalFields: number;
  fieldCountByApplicationId: Record<string, number>;
} {
  const fieldCountByApplicationId: Record<string, number> = {};
  for (const group of queue.groups) {
    fieldCountByApplicationId[group.applicationId] = group.fieldCount;
  }
  return {
    applicationCount: queue.groups.length,
    totalFields: queue.counts.total,
    fieldCountByApplicationId,
  };
}

function emptyWalls(originHost: string | null = null): NeedsYouWallInfo {
  return {
    captcha: false,
    captchaMessage: null,
    accountCreation: false,
    accountMessage: null,
    unsupported: false,
    unsupportedReason: null,
    originHost,
  };
}

function isEligibilityExplanation(text: string): boolean {
  return (
    /\brequirement:\s*/i.test(text) ||
    /\bis on file\b/i.test(text) ||
    /\bdoes not clearly settle\b/i.test(text) ||
    /\bnot satisfied\b/i.test(text) ||
    /\beligibility\b/i.test(text)
  );
}

function groupNeedsYouItems(
  items: NeedsYouItem[],
  wallsByApp: Map<string, NeedsYouWallInfo>,
  sourceByApp: Map<string, string | null>,
): NeedsYouApplicationGroup[] {
  const groups = new Map<string, NeedsYouApplicationGroup>();
  for (const item of items) {
    const existing = groups.get(item.applicationId);
    if (existing) {
      existing.items.push(item);
      existing.fieldCount = existing.items.length;
      continue;
    }
    groups.set(item.applicationId, {
      applicationId: item.applicationId,
      href: item.applicationHref,
      company: item.company,
      role: item.role,
      initial: (item.company.trim().charAt(0) || "?").toUpperCase(),
      sourceLabel: sourceByApp.get(item.applicationId) ?? null,
      fieldCount: 1,
      walls: wallsByApp.get(item.applicationId) ?? emptyWalls(),
      items: [item],
    });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    items: [...group.items].sort(compareNeedsYouItems),
  }));
}

async function loadNeedsYouQueueImpl(polish: boolean, skipAi = false): Promise<NeedsYouQueue> {
  const ctx = await loadNeedsYouRawContext();
  const {
    profile,
    actor,
    supabase,
    active,
    openApplicationIds,
    mappedDocs,
    wallsByApp,
    sourceByApp,
    requiredDocuments,
    fieldMappings,
    fitRows,
    eligibilityRows,
    attachedVaultByApp,
    recommendedResumeByApp,
    questionsByOpp,
    latestAnswerByQuestion,
    vaultResumes,
  } = ctx;

  if (active.length === 0) {
    return {
      items: [],
      groups: [],
      documents: mappedDocs,
      openApplicationIds,
      counts: { total: 0, byKind: {} },
    };
  }

  const seenMappingKeys = new Set<string>();
  const items: NeedsYouItem[] = [];
  const eligibilityJobs: EligibilityJob[] = [];

  const pushItem = (item: NeedsYouItem) => {
    items.push(item);
  };

  for (const app of active) {
    const applicationId = String(app.id);
    const opportunityId = String(app.opportunity_id);
    const { company, role } = oppMeta(app);
    const href = `/app/applications/${applicationId}`;
    const base = {
      applicationId,
      applicationHref: href,
      company,
      role,
    };

    // Missing deadline after LLM/ingest extraction — high priority for automation.
    const opportunity = asOne(app.opportunities);
    const appDeadline = typeof app.deadline_at === "string" ? app.deadline_at.trim() : "";
    const oppDeadline =
      opportunity && typeof opportunity.deadline_at === "string" ? opportunity.deadline_at.trim() : "";
    if (!appDeadline && !oppDeadline) {
      const suggestedTz =
        (typeof app.deadline_timezone === "string" && app.deadline_timezone.trim()) ||
        (typeof profile.timezone === "string" && profile.timezone.trim()) ||
        null;
      pushItem({
        ...base,
        id: `deadline:${applicationId}`,
        kind: "deadline",
        title: "Application deadline",
        detail:
          "The platform could not find a deadline on this posting or form. Enter one so reminders and auto-attach can run before it closes.",
        inputLabel: "Deadline",
        inputType: "datetime",
        required: true,
        payload: {
          timezone: suggestedTz,
        },
      });
    }

    // Need You is for host form questions only — not review_items or eligibility analysis rows.

    const appQuestions = questionsByOpp.get(opportunityId) ?? [];
    for (const question of appQuestions) {
      const prompt = String(question.prompt ?? "");
      // Contact/profile form labels are filled from Your kit via field_mappings / kit refresh —
      // not as essay Need You answers.
      if (isStructuredFormFieldPrompt(prompt)) continue;

      const answer = latestAnswerByQuestion.get(`${applicationId}:${question.id}`);
      const missingFacts = Array.isArray(answer?.missing_facts)
        ? (answer?.missing_facts as string[]).filter((fact) => Boolean(fact) && !isNeedsYouSystemNoise(String(fact)))
        : [];
      const approved = Boolean(answer?.approved_text) || String(answer?.state ?? "") === "approved";
      const questionRequired = question.required == null ? true : Boolean(question.required);
      // Optional questions still appear (sorted last) when unanswered / not approved.
      const needsAnswer =
        !answer ||
        !approved ||
        ["needs_review", "rejected", "ai_generated"].includes(String(answer.state ?? "")) ||
        missingFacts.length > 0;

      for (const fact of missingFacts) {
        if (isStructuredFormFieldPrompt(fact)) continue;
        pushItem({
          ...base,
          id: `missing_fact:${applicationId}:${question.id}:${fact}`,
          kind: "missing_fact",
          title: fact,
          detail: `Needed for: ${prompt}`,
          inputLabel: "Store this in Application Memory",
          inputType: needsYouInputType(fact, "missing_fact"),
          required: questionRequired,
          payload: {
            questionId: String(question.id),
            answerId: answer ? String(answer.id) : null,
            profileField: detectProfileMemoryField(fact) ?? detectProfileMemoryField(prompt),
          },
        });
      }

      if (needsAnswer) {
        // Opportunity answers have no host field_type — only Yes/No heuristics may become select.
        const answerOptions = resolveNeedsYouChoiceOptions({ label: prompt, fieldType: null });
        const answerInputType =
          answerOptions.length > 0 ? ("select" as const) : needsYouInputType(prompt, "answer");
        pushItem({
          ...base,
          id: `answer:${applicationId}:${question.id}`,
          kind: "answer",
          title: prompt,
          detail: missingFacts.length
            ? `Missing memory: ${missingFacts.slice(0, 3).join("; ")}`
            : answer
              ? `Current state: ${String(answer.state).replace(/_/g, " ")}`
              : questionRequired
                ? "No answer drafted yet — write one or let the platform draft after you add facts."
                : "Optional question — answer if you want it included in this application.",
          inputLabel: answerInputType === "select" ? "Choose an option" : "Your answer",
          inputType: answerInputType,
          required: questionRequired,
          options: answerOptions.length > 0 ? answerOptions : undefined,
          payload: {
            questionId: String(question.id),
            answerId: answer ? String(answer.id) : null,
            profileField: detectProfileMemoryField(prompt),
          },
        });
      }
    }

    const attachedVault = attachedVaultByApp.get(applicationId) ?? [];
    const recommendedResume = recommendedResumeByApp.get(applicationId) ?? null;
    for (const doc of (requiredDocuments ?? []).filter(
      (row) => String(row.opportunity_id) === opportunityId,
    )) {
      const label = String(doc.label);
      const docRequired = doc.required !== false;
      if (requiredDocumentCovered(label, attachedVault)) continue;

      const requiredKind = classifyRequiredDocumentLabel(label);
      const isResumeReq = requiredKind === "resume";
      const isImage = isImageUploadRequest(label);
      let documentStatus: "unavailable" | "not_best_fit" | "attach" = "attach";
      let detail = docRequired
        ? "Required for this application — attach from Application Memory or upload."
        : "Optional document for this application — attach if you have it.";
      let recommendedDocumentId: string | null = null;
      let recommendedDocumentLabel: string | null = null;
      let fitScore: number | null = null;
      let fitSuggestion: string | null = null;

      if (isResumeReq) {
        if (vaultResumes.length === 0) {
          documentStatus = "unavailable";
          detail =
            "Resume/CV isn’t available in Application Memory yet. Upload one here or in Resumes — then the platform can attach the best fit.";
        } else if (recommendedResume?.weakFit) {
          documentStatus = "not_best_fit";
          recommendedDocumentId = recommendedResume.documentId;
          recommendedDocumentLabel = recommendedResume.label;
          fitScore = recommendedResume.score;
          fitSuggestion = recommendedResume.suggestion;
          detail =
            recommendedResume.suggestion ||
            `Best available resume is “${recommendedResume.label}” (${recommendedResume.score}% fit). Approve it anyway, or upload a better-targeted version. If you don’t, the platform will attach this best fit before the deadline.`;
        } else if (recommendedResume) {
          documentStatus = "attach";
          recommendedDocumentId = recommendedResume.documentId;
          recommendedDocumentLabel = recommendedResume.label;
          fitScore = recommendedResume.score;
          detail = `Recommended resume: “${recommendedResume.label}” (${recommendedResume.score}% fit). Confirm to attach it to this application.`;
        } else {
          documentStatus = "attach";
          const match = matchVaultDocument(label, vaultResumes);
          recommendedDocumentId = match?.id ?? vaultResumes[0]?.id ?? null;
          recommendedDocumentLabel = match?.label ?? vaultResumes[0]?.label ?? null;
          detail =
            "A resume is in Application Memory — confirm the best fit to attach it to this application.";
        }
      } else if (!isImage) {
        const match = matchVaultDocument(label, mappedDocs);
        if (!match) {
          documentStatus = "unavailable";
          detail = docRequired
            ? `${label} isn’t available in Application Memory yet. Upload it to continue.`
            : `${label} isn’t in Application Memory — upload if you want it included.`;
        } else {
          recommendedDocumentId = match.id;
          recommendedDocumentLabel = match.label;
          detail = docRequired
            ? `Found “${match.label}” in Application Memory — confirm to attach.`
            : `Optional: “${match.label}” is available in Application Memory.`;
        }
      }

      pushItem({
        ...base,
        id: `document:${applicationId}:${doc.id}`,
        kind: "document",
        title: label,
        detail,
        inputLabel: isImage ? "Attach an existing image" : "Attach an existing document",
        inputType: isImage ? "image" : "document",
        required: docRequired,
        payload: {
          requiredLabel: label,
          uploadKind: isImage ? "image" : "document",
          documentStatus,
          recommendedDocumentId,
          recommendedDocumentLabel,
          fitScore,
          fitSuggestion,
        },
      });
    }

    for (const mapping of (fieldMappings ?? []).filter(
      (row) => String(row.application_id) === applicationId,
    )) {
      const fieldKey = String(mapping.field_key);
      const dedupe = `${applicationId}:${fieldKey}`;
      if (seenMappingKeys.has(dedupe)) continue;
      seenMappingKeys.add(dedupe);

      const value = String(mapping.value ?? "").trim();
      const pending =
        !value ||
        Number(mapping.confidence ?? 0) < 0.75 ||
        Boolean(mapping.excluded_by_default);
      if (!pending) continue;

      const rawLabel = String(mapping.label || "").trim();
      const title = humanQuestionLabel({
        label: rawLabel,
        nearbyText: "",
        ariaLabel: "",
        placeholder: "",
        name: fieldKey,
        id: fieldKey,
        key: fieldKey,
      });

      // Skip plumbing / hex ids that never resolved to a real question.
      if (
        title === "Form question" ||
        (/share[-_\s]?link/i.test(fieldKey) && isMachineFieldToken(rawLabel || fieldKey)) ||
        (isMachineFieldToken(fieldKey) && isMachineFieldToken(rawLabel) && title === humanizeFieldToken(fieldKey))
      ) {
        continue;
      }

      const fieldType = normalizeNeedsYouFieldType(
        typeof mapping.field_type === "string" ? mapping.field_type : null,
      );
      const choiceOptions = resolveNeedsYouChoiceOptions({
        label: title,
        fieldType,
        mappingOptions: mapping.options,
      });
      const meta =
        mapping.meta && typeof mapping.meta === "object" && !Array.isArray(mapping.meta)
          ? (mapping.meta as Record<string, unknown>)
          : {};
      const uploadKindRaw = typeof meta.uploadKind === "string" ? meta.uploadKind : "";
      const uploadKind =
        uploadKindRaw === "image" || isImageUploadRequest(title, String(meta.accept ?? ""))
          ? "image"
          : "document";
      const mappingRequired =
        typeof meta.required === "boolean"
          ? meta.required
          : !Boolean(mapping.excluded_by_default);

      let inputType: NeedsYouInputType = needsYouInputType(title, "field_mapping");
      let kind: NeedsYouItem["kind"] = "field_mapping";
      let detail = value
        ? `Proposed “${value.slice(0, 120)}” needs confirmation (confidence ${Number(mapping.confidence ?? 0).toFixed(2)}).`
        : mappingRequired
          ? "The platform has no memory for this form question yet."
          : "Optional form field — fill if you want it included.";
      let inputLabel = "Value to store and use";

      if (fieldType === "file") {
        kind = "document";
        inputType = uploadKind === "image" ? "image" : "document";
        inputLabel = uploadKind === "image" ? "Upload or attach an image" : "Attach an existing document";
        const resumeLike = classifyRequiredDocumentLabel(title) === "resume";
        const attachedVault = attachedVaultByApp.get(applicationId) ?? [];
        if (resumeLike && requiredDocumentCovered(title || "Resume", attachedVault)) {
          continue;
        }
        const recommendedResume = recommendedResumeByApp.get(applicationId) ?? null;
        let documentStatus: "unavailable" | "not_best_fit" | "attach" = "attach";
        let recommendedDocumentId: string | null = null;
        let recommendedDocumentLabel: string | null = null;
        let fitScore: number | null = null;
        let fitSuggestion: string | null = null;
        if (uploadKind === "image") {
          detail = "This application asks for an image (photo / headshot / scan).";
        } else if (resumeLike && vaultResumes.length === 0) {
          documentStatus = "unavailable";
          detail =
            "Resume/CV isn’t available in Application Memory yet. Upload one here or in Resumes.";
        } else if (resumeLike && recommendedResume?.weakFit) {
          documentStatus = "not_best_fit";
          recommendedDocumentId = recommendedResume.documentId;
          recommendedDocumentLabel = recommendedResume.label;
          fitScore = recommendedResume.score;
          fitSuggestion = recommendedResume.suggestion;
          detail =
            recommendedResume.suggestion ||
            `Best available resume is “${recommendedResume.label}” (${recommendedResume.score}% fit). Approve it anyway, or upload a better one before the deadline.`;
        } else if (resumeLike && recommendedResume) {
          recommendedDocumentId = recommendedResume.documentId;
          recommendedDocumentLabel = recommendedResume.label;
          fitScore = recommendedResume.score;
          detail = `Recommended: “${recommendedResume.label}” (${recommendedResume.score}% fit).`;
        } else {
          detail = "This application asks for a file upload from the host form.";
          const match = matchVaultDocument(title, mappedDocs);
          if (match) {
            recommendedDocumentId = match.id;
            recommendedDocumentLabel = match.label;
          }
        }

        pushItem({
          ...base,
          id: `mapping:${mapping.id}`,
          kind,
          title,
          detail,
          inputLabel,
          inputType,
          required: mappingRequired,
          payload: {
            mappingId: String(mapping.id),
            profileField: detectProfileMemoryField(title),
            requiredLabel: title,
            uploadKind,
            documentStatus,
            recommendedDocumentId,
            recommendedDocumentLabel,
            fitScore,
            fitSuggestion,
          },
        });
        continue;
      }

      // Host field_type wins — never turn kit chip options on text/textarea into selects.
      const safeChoiceOptions = isChoiceFieldType(fieldType) ? choiceOptions : [];
      const hostInputType = inputTypeFromHostFieldType(fieldType, title, safeChoiceOptions.length);
      if (hostInputType === "multi-select" && safeChoiceOptions.length > 0) {
        inputType = "multi-select";
        inputLabel = "Choose all that apply";
        detail = value
          ? `Proposed “${value.slice(0, 120)}” — confirm or adjust the selections.`
          : "Select every option that applies on the application form.";
      } else if (hostInputType === "select" && safeChoiceOptions.length > 0) {
        inputType = "select";
        inputLabel = "Choose an option";
        detail = value
          ? `Proposed “${value.slice(0, 120)}” — confirm or pick another option.`
          : "Pick one of the options from the application form.";
      } else if (hostInputType === "textarea") {
        inputType = "textarea";
        inputLabel = "Your answer";
      } else if (hostInputType === "date") {
        inputType = "date";
      } else if (hostInputType === "number") {
        inputType = "number";
      } else if (hostInputType === "url") {
        inputType = "url";
      } else if (hostInputType === "email" || /email/i.test(title)) {
        inputType = "email";
      } else if (hostInputType === "tel" || detectProfileMemoryField(title) === "phone") {
        inputType = "tel";
      } else if (hostInputType === "text") {
        inputType = "text";
      } else if (safeChoiceOptions.length > 1) {
        inputType = "multi-select";
        inputLabel = "Choose all that apply";
      } else if (safeChoiceOptions.length > 0) {
        inputType = "select";
        inputLabel = "Choose an option";
      }

      pushItem({
        ...base,
        id: `mapping:${mapping.id}`,
        kind,
        title,
        detail,
        inputLabel,
        inputType,
        required: mappingRequired,
        options:
          inputType === "select" || inputType === "multi-select" ? safeChoiceOptions : undefined,
        payload: {
          mappingId: String(mapping.id),
          profileField: detectProfileMemoryField(title),
          requiredLabel: title,
          currentValue: value || null,
        },
      });
    }

    const fit = (fitRows ?? []).find((row) => String(row.application_id) === applicationId);
    const missing = Array.isArray(fit?.missing) ? (fit?.missing as string[]) : [];
    for (const gap of missing.slice(0, 8)) {
      if (isNeedsYouSystemNoise(gap)) continue;
      // Eligibility blockers are handled below via eligibility_results + LLM targets.
      if (isEligibilityExplanation(gap)) continue;
      pushItem({
        ...base,
        id: `fit:${applicationId}:${gap}`,
        kind: "missing_fact",
        title: gap,
        detail: "Flagged by Fit Index as missing from Application Memory.",
        inputLabel: "Add this to Application Memory",
        inputType: needsYouInputType(gap, "missing_fact"),
        required: true,
        payload: { profileField: detectProfileMemoryField(gap) },
      });
    }

    const appEligibility = (eligibilityRows ?? []).filter(
      (row) =>
        String(row.application_id) === applicationId &&
        !row.user_confirmed_at &&
        ["unclear", "not_met", "partial", "needs_confirmation"].includes(String(row.state ?? "")),
    );
    if (appEligibility.length > 0) {
      const gaps: EligibilityGap[] = appEligibility.slice(0, 6).map((row) => ({
        id: String(row.id),
        requirementId: row.requirement_id ? String(row.requirement_id) : null,
        requirementText: String(row.requirement_text ?? ""),
        requirementKind: String(row.requirement_kind ?? "general"),
        explanation: String(row.explanation ?? ""),
        state: String(row.state ?? "unclear"),
      }));

      if (skipAi) {
        const memoryCheck = await verifyEligibilityFromMemory(supabase, actor, applicationId, gaps);
        const ackIds = memoryCheck.remaining
          .filter((gap) => gap.state !== "not_met")
          .map((gap) => gap.id);
        await markEligibilityAckOnly(supabase, actor.userId, ackIds);
        for (const gap of memoryCheck.remaining) {
          const needsAck = gap.state !== "not_met";
          pushItem({
            ...base,
            id: `eligibility:${applicationId}:${gap.id}:count`,
            kind: "eligibility",
            title: gap.requirementText || "Eligibility requirement",
            detail: gap.explanation,
            inputLabel: needsAck ? "Confirm eligibility" : "Eligibility",
            inputType: "text",
            required: true,
            payload: {
              eligibilityId: gap.id,
              requirementId: gap.requirementId ?? null,
              eligibilityIssue: gap.explanation,
              eligibilityRequirement: gap.requirementText,
              allowDeleteApplication: true,
              confirmEligible: needsAck,
            },
          });
        }
        continue;
      }

      eligibilityJobs.push({
        applicationId,
        base,
        gaps,
        appQuestions,
      });
    }
  }

  if (eligibilityJobs.length > 0) {
    const eligibilityBatches = await Promise.all(
      eligibilityJobs.map((job) => buildEligibilityNeedsYouItems(ctx, job)),
    );
    for (const batch of eligibilityBatches) {
      for (const item of batch) {
        pushItem(item);
      }
    }
  }

  // Collapse the same form question when it appears as answer + field_mapping (etc.).
  const deduped = dedupeNeedsYouItems(items);

  // Strip ATS required-chrome from titles (***Obligatoriskt***, *Required*, etc.); AI only for leftovers.
  if (polish) {
    const polishTargets = deduped.filter(
      (item) =>
        item.kind === "field_mapping" ||
        item.kind === "answer" ||
        item.kind === "missing_fact" ||
        item.kind === "eligibility",
    );
    const polished = await polishFormQuestionLabels(
      polishTargets.map((item) => ({ id: item.id, title: item.title })),
    );
    for (const item of deduped) {
      const clean = polished.get(item.id);
      if (clean) item.title = clean;
    }
  }

  const byKind: Record<string, number> = {};
  for (const item of deduped) {
    byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
  }

  deduped.sort(compareNeedsYouItems);

  return {
    items: deduped,
    groups: groupNeedsYouItems(deduped, wallsByApp, sourceByApp),
    documents: mappedDocs,
    openApplicationIds,
    counts: { total: deduped.length, byKind },
  };
}

const loadNeedsYouQueueCached = cache(async (polish: boolean, skipAi: boolean): Promise<NeedsYouQueue> => {
  return loadNeedsYouQueueImpl(polish, skipAi);
});

export function loadNeedsYouQueue(options?: { polish?: boolean }): Promise<NeedsYouQueue> {
  return loadNeedsYouQueueCached(options?.polish !== false, false);
}

/** Fast nav badge — skips resolveEligibilityActionTargets AI; uses memory verify only. */
export const loadNeedsYouBadgeCounts = cache(async () => {
  return countsFromNeedsYouQueue(await loadNeedsYouQueueCached(false, true));
});

/** Dashboard + applications table — full queue (same items as /app/needs-you). */
export const loadNeedsYouFieldCounts = cache(async (): Promise<{
  applicationCount: number;
  totalFields: number;
  fieldCountByApplicationId: Record<string, number>;
}> => {
  return countsFromNeedsYouQueue(await loadNeedsYouQueue({ polish: false }));
});
