import {
  classifyVaultDocument,
  isWeakResumeFit,
} from "@1apply/domain";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { normalizeApplicationStatus } from "@/lib/application-workflow";
import { sourceLabelFromOpportunity } from "@/lib/dashboard-display";
import { formatNeedsYouDocumentOption, isChoiceFieldType, normalizeNeedsYouFieldType } from "@/lib/needs-you-field-kinds";
import type { ProfileRow } from "@/lib/profile";
import { requireWorkspace } from "@/server/auth/require-workspace";
import { asOne } from "@/server/types";

export type NeedsYouDocumentOption = {
  id: string;
  label: string;
  type: string;
  currentVersionId: string | null;
  versionLabel: string | null;
  categoryLabel: string | null;
  fileName: string | null;
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

type ApplicationRow = {
  id: string;
  status: string | null;
  next_action: string | null;
  opportunity_id: string;
  deadline_at: string | null;
  deadline_timezone: string | null;
  updated_at: string | null;
  opportunities?:
    | { title?: string | null; organization?: string | null; source?: string | null; deadline_at?: string | null }
    | Array<{ title?: string | null; organization?: string | null; source?: string | null; deadline_at?: string | null }>
    | null;
};

export type NeedsYouRawContext = {
  user: User;
  supabase: SupabaseClient;
  profile: ProfileRow;
  actor: Actor;
  active: ApplicationRow[];
  openApplicationIds: string[];
  mappedDocs: NeedsYouDocumentOption[];
  wallsByApp: Map<string, NeedsYouWallInfo>;
  sourceByApp: Map<string, string | null>;
  answers: Array<Record<string, unknown>>;
  questions: Array<{
    id: string;
    opportunity_id: string;
    prompt: string | null;
    required: boolean | null;
    sort_order: number | null;
  }>;
  requiredDocuments: Array<{ id: string; opportunity_id: string; label: string; required: boolean | null }>;
  fieldMappings: Array<Record<string, unknown>>;
  fitRows: Array<{ application_id: string; missing: unknown }>;
  eligibilityRows: Array<Record<string, unknown>>;
  attachedVaultByApp: Map<string, Array<{ type: string; label: string; id: string }>>;
  recommendedResumeByApp: Map<
    string,
    { documentId: string; label: string; score: number; suggestion: string | null; weakFit: boolean }
  >;
  questionsByOpp: Map<string, NeedsYouRawContext["questions"]>;
  latestAnswerByQuestion: Map<string, Record<string, unknown>>;
  vaultResumes: NeedsYouDocumentOption[];
  docById: Map<string, NeedsYouDocumentOption>;
};

/** Cached Supabase fan-out for Need You — shared across badge counts and full queue on one request. */
export const loadNeedsYouRawContext = cache(async (): Promise<NeedsYouRawContext> => {
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
  ) as ApplicationRow[];

  const openApplicationIds = active.map((row) => String(row.id));
  const sourceByApp = new Map(active.map((row) => [String(row.id), oppMeta(row).sourceLabel] as const));

  if (active.length === 0) {
    return {
      user,
      supabase,
      profile,
      actor,
      active,
      openApplicationIds,
      mappedDocs,
      wallsByApp: new Map(),
      sourceByApp,
      answers: [],
      questions: [],
      requiredDocuments: [],
      fieldMappings: [],
      fitRows: [],
      eligibilityRows: [],
      attachedVaultByApp: new Map(),
      recommendedResumeByApp: new Map(),
      questionsByOpp: new Map(),
      latestAnswerByQuestion: new Map(),
      vaultResumes: [],
      docById: new Map(mappedDocs.map((doc) => [doc.id, doc] as const)),
    };
  }

  const appIds = openApplicationIds;
  const oppIds = [...new Set(active.map((row) => String(row.opportunity_id)))];

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
        "id, application_id, field_key, label, value, source, confidence, excluded_by_default, sensitive, created_at, field_type, options, meta",
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
        "id, application_id, requirement_id, state, explanation, requirement_text, requirement_kind, needs_confirmation, user_confirmed_at, ack_only, memory_checked_at",
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

  const docById = new Map(mappedDocs.map((doc) => [doc.id, doc] as const));
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

  const normalizedQuestions = (questions ?? []).map((question) => ({
    id: String(question.id),
    opportunity_id: String(question.opportunity_id),
    prompt: question.prompt,
    required: question.required,
    sort_order: question.sort_order,
  }));

  const questionsByOpp = new Map<string, typeof normalizedQuestions>();
  for (const question of normalizedQuestions) {
    const oppId = question.opportunity_id;
    const list = questionsByOpp.get(oppId) ?? [];
    list.push(question);
    questionsByOpp.set(oppId, list);
  }

  const latestAnswerByQuestion = new Map<string, Record<string, unknown>>();
  for (const answer of answers ?? []) {
    const key = `${answer.application_id}:${answer.question_id}`;
    const existing = latestAnswerByQuestion.get(key);
    if (!existing || String(answer.created_at) > String(existing.created_at)) {
      latestAnswerByQuestion.set(key, answer as Record<string, unknown>);
    }
  }

  return {
    user,
    supabase,
    profile,
    actor,
    active,
    openApplicationIds,
    mappedDocs,
    wallsByApp,
    sourceByApp,
    answers: (answers ?? []) as NeedsYouRawContext["answers"],
    questions: normalizedQuestions,
    requiredDocuments: (requiredDocuments ?? []).map((row) => ({
      id: String(row.id),
      opportunity_id: String(row.opportunity_id),
      label: String(row.label),
      required: row.required,
    })),
    fieldMappings: (fieldMappings ?? []) as Array<Record<string, unknown>>,
    fitRows: (fitRows ?? []) as NeedsYouRawContext["fitRows"],
    eligibilityRows: (eligibilityRows ?? []) as Array<Record<string, unknown>>,
    attachedVaultByApp,
    recommendedResumeByApp,
    questionsByOpp,
    latestAnswerByQuestion,
    vaultResumes,
    docById,
  };
});
