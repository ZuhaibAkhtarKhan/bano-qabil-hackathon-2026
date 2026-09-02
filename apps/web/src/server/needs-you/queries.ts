import { humanQuestionLabel, humanizeFieldToken, isMachineFieldToken } from "@1apply/form-engine";
import {
  classifyRequiredDocumentLabel,
  classifyVaultDocument,
  isWeakResumeFit,
  matchVaultDocument,
  requiredDocumentCovered,
} from "@1apply/domain";
import { cache } from "react";

import { normalizeApplicationStatus } from "@/lib/application-workflow";
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
  formatNeedsYouDocumentOption,
  inputTypeFromHostFieldType,
  isChoiceFieldType,
  isImageUploadRequest,
  normalizeNeedsYouFieldType,
  resolveNeedsYouChoiceOptions,
} from "@/lib/needs-you-field-kinds";
import { requireWorkspace } from "@/server/auth/require-workspace";
import { polishFormQuestionLabels } from "@/server/needs-you/polish-labels";
import {
  defaultProfileCandidates,
  resolveEligibilityActionTargets,
  type EligibilityCandidate,
  type EligibilityGap,
} from "@/server/needs-you/resolve-eligibility-actions-ai";
import { verifyEligibilityFromMemory } from "@/server/needs-you/verify-eligibility-from-memory";
import { asOne } from "@/server/types";

const ACTIVE_STATUSES = new Set([
  "saved",
  "analyzing",
  "ready_to_apply",
  "in_progress",
  "review_required",
  "draft",
  "preparing",
  "ready",
]);

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
  counts: {
    total: number;
    byKind: Record<string, number>;
  };
};

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

function parseHazards(raw: unknown, origin: string | null): NeedsYouWallInfo {
  const host = (() => {
    if (!origin) return null;
    try {
      return new URL(origin).host;
    } catch {
      return origin.slice(0, 80);
    }
  })();
  if (!raw || typeof raw !== "object") return emptyWalls(host);
  const h = raw as Record<string, unknown>;
  return {
    captcha: Boolean(h.captcha),
    captchaMessage: typeof h.captchaMessage === "string" ? h.captchaMessage : null,
    accountCreation: Boolean(h.accountCreation),
    accountMessage: typeof h.accountMessage === "string" ? h.accountMessage : null,
    unsupported: Boolean(h.unsupported),
    unsupportedReason: typeof h.unsupportedReason === "string" ? h.unsupportedReason : null,
    originHost: host,
  };
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

async function loadNeedsYouQueueImpl(polish: boolean): Promise<NeedsYouQueue> {
  const { user, supabase, profile, actor } = await requireWorkspace();

  const [{ data: applications }, { data: documents }, { data: resumeRows }] = await Promise.all([
    supabase
      .from("applications")
      .select(
        "id, status, next_action, opportunity_id, deadline_at, deadline_timezone, updated_at, opportunities ( title, organization, source, deadline_at )",
      )
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("documents")
      .select(
        "id, type, label, current_version_id, document_versions!document_id ( id, version_label, original_filename, status )",
      )
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("resumes")
      .select("document_id, category_key, category_label, target_role")
      .eq("user_id", user.id),
  ]);

  const resumeMetaByDoc = new Map(
    (resumeRows ?? []).map((row) => [
      String(row.document_id),
      {
        categoryLabel:
          String(row.category_label ?? "").trim() ||
          String(row.target_role ?? "").trim() ||
          (row.category_key ? String(row.category_key).replace(/_/g, " ") : null),
      },
    ]),
  );

  const mappedDocs: NeedsYouDocumentOption[] = (documents ?? []).map((doc) => {
    const versions = Array.isArray(doc.document_versions)
      ? doc.document_versions
      : doc.document_versions
        ? [doc.document_versions]
        : [];
    const currentId = (doc.current_version_id as string | null) ?? null;
    const current =
      versions.find((item) => String((item as { id?: string }).id) === currentId) ?? versions[0] ?? null;
    const versionLabel = current
      ? String((current as { version_label?: string | null }).version_label ?? "").trim() || null
      : null;
    const fileName = current
      ? String((current as { original_filename?: string | null }).original_filename ?? "").trim() || null
      : null;
    const categoryLabel = resumeMetaByDoc.get(String(doc.id))?.categoryLabel ?? null;
    const label = String(doc.label);
    const type = String(doc.type);
    return {
      id: String(doc.id),
      label,
      type,
      currentVersionId: currentId,
      versionLabel,
      categoryLabel,
      fileName,
      displayLabel: formatNeedsYouDocumentOption({
        label,
        type,
        versionLabel,
        categoryLabel,
        fileName,
      }),
    };
  });

  const active = (applications ?? []).filter((row) =>
    ACTIVE_STATUSES.has(normalizeApplicationStatus(row.status as Parameters<typeof normalizeApplicationStatus>[0])),
  );

  if (active.length === 0) {
    return {
      items: [],
      groups: [],
      documents: mappedDocs,
      counts: { total: 0, byKind: {} },
    };
  }

  const appIds = active.map((row) => String(row.id));
  const oppIds = [...new Set(active.map((row) => String(row.opportunity_id)))];
  const sourceByApp = new Map(
    active.map((row) => [String(row.id), oppMeta(row).sourceLabel] as const),
  );

  const [
    { data: answers },
    { data: questions },
    { data: requiredDocuments },
    { data: attached },
    { data: fieldMappings },
    { data: fitRows },
    { data: fillSessions },
    { data: eligibilityRows },
    { data: resumeMatches },
  ] = await Promise.all([
    supabase
      .from("application_answers")
      .select(
        "id, application_id, question_id, state, approved_text, user_edited_text, original_ai_text, missing_facts, created_at",
      )
      .eq("user_id", user.id)
      .in("application_id", appIds),
    supabase
      .from("opportunity_questions")
      .select("id, opportunity_id, prompt, required, sort_order")
      .eq("user_id", user.id)
      .in("opportunity_id", oppIds)
      .order("sort_order", { ascending: true }),
    supabase
      .from("opportunity_documents")
      .select("id, opportunity_id, label, required")
      .eq("user_id", user.id)
      .in("opportunity_id", oppIds),
    supabase
      .from("application_documents")
      .select("id, application_id, document_id")
      .eq("user_id", user.id)
      .in("application_id", appIds),
    supabase
      .from("field_mappings")
      .select(
        "id, application_id, field_key, label, value, confidence, excluded_by_default, sensitive, created_at, field_type, options, meta",
      )
      .eq("user_id", user.id)
      .in("application_id", appIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("fit_evaluations")
      .select("application_id, missing")
      .eq("user_id", user.id)
      .in("application_id", appIds),
    supabase
      .from("fill_sessions")
      .select("application_id, origin, hazards, created_at")
      .eq("user_id", user.id)
      .in("application_id", appIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("eligibility_results")
      .select(
        "id, application_id, state, explanation, requirement_text, requirement_kind, needs_confirmation, user_confirmed_at, ack_only",
      )
      .eq("user_id", user.id)
      .in("application_id", appIds),
    supabase
      .from("resume_matches")
      .select("application_id, document_id, score, recommended, suggestion, label")
      .eq("user_id", user.id)
      .in("application_id", appIds),
  ]);

  const wallsByApp = new Map<string, NeedsYouWallInfo>();
  for (const session of fillSessions ?? []) {
    const applicationId = String(session.application_id);
    if (wallsByApp.has(applicationId)) continue;
    wallsByApp.set(
      applicationId,
      parseHazards(session.hazards, typeof session.origin === "string" ? session.origin : null),
    );
  }

  // Legacy fill-plans stored kit chip suggestions in options for text/textarea — scrub those rows.
  const pollutedMappingIds = (fieldMappings ?? [])
    .filter((row) => {
      const fieldType = normalizeNeedsYouFieldType(
        typeof row.field_type === "string" ? row.field_type : null,
      );
      if (!fieldType || isChoiceFieldType(fieldType)) return false;
      return Array.isArray(row.options) && row.options.length > 0;
    })
    .map((row) => String(row.id));
  if (pollutedMappingIds.length > 0) {
    void supabase.from("field_mappings").update({ options: [] }).in("id", pollutedMappingIds);
    for (const row of fieldMappings ?? []) {
      if (pollutedMappingIds.includes(String(row.id))) {
        (row as { options?: unknown }).options = [];
      }
    }
  }

  const docById = new Map(
    mappedDocs.map((doc) => [doc.id, doc] as const),
  );
  const vaultResumes = mappedDocs.filter((doc) => classifyVaultDocument(doc) === "resume");
  const attachedVaultByApp = new Map<string, Array<{ type: string; label: string; id: string }>>();
  for (const row of attached ?? []) {
    const appId = String(row.application_id);
    const doc = docById.get(String(row.document_id));
    if (!doc) continue;
    const list = attachedVaultByApp.get(appId) ?? [];
    list.push({ id: doc.id, type: doc.type, label: doc.label });
    attachedVaultByApp.set(appId, list);
  }

  const recommendedResumeByApp = new Map<
    string,
    { documentId: string; label: string; score: number; suggestion: string | null; weakFit: boolean }
  >();
  for (const row of resumeMatches ?? []) {
    if (!row.recommended) continue;
    const applicationId = String(row.application_id);
    const documentId = String(row.document_id);
    const score = typeof row.score === "number" ? row.score : Number(row.score ?? 0);
    const suggestion = typeof row.suggestion === "string" ? row.suggestion : null;
    const doc = docById.get(documentId);
    recommendedResumeByApp.set(applicationId, {
      documentId,
      label: (typeof row.label === "string" && row.label.trim()) || doc?.label || "Recommended resume",
      score,
      suggestion,
      weakFit: isWeakResumeFit(score) || Boolean(suggestion),
    });
  }

  const questionsByOpp = new Map<string, typeof questions>();
  for (const question of questions ?? []) {
    const oppId = String(question.opportunity_id);
    const list = questionsByOpp.get(oppId) ?? [];
    list.push(question);
    questionsByOpp.set(oppId, list);
  }

  const latestAnswerByQuestion = new Map<
    string,
    NonNullable<typeof answers>[number]
  >();
  for (const answer of answers ?? []) {
    const key = `${answer.application_id}:${answer.question_id}`;
    const existing = latestAnswerByQuestion.get(key);
    if (!existing || String(answer.created_at) > String(existing.created_at)) {
      latestAnswerByQuestion.set(key, answer);
    }
  }

  const seenMappingKeys = new Set<string>();
  const items: NeedsYouItem[] = [];

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
      let gaps: EligibilityGap[] = appEligibility.slice(0, 6).map((row) => ({
        id: String(row.id),
        requirementText: String(row.requirement_text ?? ""),
        requirementKind: String(row.requirement_kind ?? "general"),
        explanation: String(row.explanation ?? ""),
        state: String(row.state ?? "unclear"),
      }));

      const memoryCheck = await verifyEligibilityFromMemory(supabase, actor, applicationId, gaps);
      gaps = memoryCheck.remaining;

      if (gaps.length === 0) {
        continue;
      }

      const candidates: EligibilityCandidate[] = [...defaultProfileCandidates()];
      const seenCandidate = new Set(candidates.map((c) => c.id));

      for (const mapping of (fieldMappings ?? []).filter((row) => String(row.application_id) === applicationId)) {
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
        (fieldMappings ?? [])
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
          pushItem({
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

        pushItem({
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
        pushItem({
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
    counts: { total: deduped.length, byKind },
  };
}

const loadNeedsYouQueueCached = cache(async (polishFlag: "yes" | "no"): Promise<NeedsYouQueue> =>
  loadNeedsYouQueueImpl(polishFlag === "yes"),
);

export function loadNeedsYouQueue(options?: { polish?: boolean }): Promise<NeedsYouQueue> {
  return loadNeedsYouQueueCached(options?.polish === false ? "no" : "yes");
}

/** Lightweight counts for nav badge + applications table (skips label polish). */
export const loadNeedsYouFieldCounts = cache(async (): Promise<{
  applicationCount: number;
  totalFields: number;
  fieldCountByApplicationId: Record<string, number>;
}> => {
  const queue = await loadNeedsYouQueue({ polish: false });
  const fieldCountByApplicationId: Record<string, number> = {};
  for (const group of queue.groups) {
    fieldCountByApplicationId[group.applicationId] = group.fieldCount;
  }
  return {
    applicationCount: queue.groups.length,
    totalFields: queue.counts.total,
    fieldCountByApplicationId,
  };
});
