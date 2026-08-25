import { normalizeApplicationStatus } from "@/lib/application-workflow";
import {
  detectProfileMemoryField,
  needsYouInputType,
  type NeedsYouItem,
} from "@/lib/needs-you";
import { requireWorkspace } from "@/server/auth/require-workspace";
import { asOne } from "@/server/types";
import { humanQuestionLabel, humanizeFieldToken, isMachineFieldToken } from "@1apply/form-engine";

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
    | { title?: string | null; organization?: string | null }
    | Array<{ title?: string | null; organization?: string | null }>
    | null;
}) {
  const opportunity = asOne(row.opportunities);
  return {
    company: opportunity?.organization?.trim() || "Unknown organization",
    role: opportunity?.title?.trim() || "Untitled role",
  };
}

export type NeedsYouDocumentOption = {
  id: string;
  label: string;
  type: string;
  currentVersionId: string | null;
};

export type NeedsYouQueue = {
  items: NeedsYouItem[];
  documents: NeedsYouDocumentOption[];
  counts: {
    total: number;
    byKind: Record<string, number>;
  };
};

export async function loadNeedsYouQueue(): Promise<NeedsYouQueue> {
  const { user, supabase } = await requireWorkspace();

  const [{ data: applications }, { data: documents }] = await Promise.all([
    supabase
      .from("applications")
      .select(
        "id, status, next_action, opportunity_id, updated_at, opportunities ( title, organization )",
      )
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("documents")
      .select("id, type, label, current_version_id")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
  ]);

  const active = (applications ?? []).filter((row) =>
    ACTIVE_STATUSES.has(normalizeApplicationStatus(row.status as Parameters<typeof normalizeApplicationStatus>[0])),
  );

  if (active.length === 0) {
    return {
      items: [],
      documents: (documents ?? []).map((doc) => ({
        id: String(doc.id),
        label: String(doc.label),
        type: String(doc.type),
        currentVersionId: (doc.current_version_id as string | null) ?? null,
      })),
      counts: { total: 0, byKind: {} },
    };
  }

  const appIds = active.map((row) => String(row.id));
  const oppIds = [...new Set(active.map((row) => String(row.opportunity_id)))];
  const appById = new Map(active.map((row) => [String(row.id), row]));

  const [
    { data: reviewItems },
    { data: answers },
    { data: questions },
    { data: requiredDocuments },
    { data: attached },
    { data: eligibility },
    { data: fieldMappings },
    { data: fitRows },
  ] = await Promise.all([
    supabase
      .from("review_items")
      .select("id, application_id, kind, prompt, resolved")
      .eq("user_id", user.id)
      .in("application_id", appIds)
      .eq("resolved", false),
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
      .from("eligibility_results")
      .select(
        "id, application_id, state, explanation, requirement_text, needs_confirmation, display_state",
      )
      .eq("user_id", user.id)
      .in("application_id", appIds),
    supabase
      .from("field_mappings")
      .select(
        "id, application_id, field_key, label, value, confidence, excluded_by_default, sensitive, created_at",
      )
      .eq("user_id", user.id)
      .in("application_id", appIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("fit_evaluations")
      .select("application_id, missing")
      .eq("user_id", user.id)
      .in("application_id", appIds),
  ]);

  const docLabelById = new Map(
    (documents ?? []).map((doc) => [String(doc.id), String(doc.label ?? "")]),
  );
  const attachedLabelsByApp = new Map<string, Set<string>>();
  for (const row of attached ?? []) {
    const appId = String(row.application_id);
    const label = docLabelById.get(String(row.document_id));
    if (!label) continue;
    const set = attachedLabelsByApp.get(appId) ?? new Set<string>();
    set.add(label.toLowerCase());
    attachedLabelsByApp.set(appId, set);
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

    for (const item of (reviewItems ?? []).filter((row) => String(row.application_id) === applicationId)) {
      const title = String(item.prompt ?? "Resolve this review item");
      pushItem({
        ...base,
        id: `review:${item.id}`,
        kind: "review",
        title,
        detail: item.kind ? `Kind: ${item.kind}` : null,
        inputLabel: "What should Application Memory store?",
        inputType: needsYouInputType(title, "review"),
        payload: {
          reviewItemId: String(item.id),
          factKey: detectProfileMemoryField(title) ?? undefined,
          profileField: detectProfileMemoryField(title),
        },
      });
    }

    for (const row of (eligibility ?? []).filter((item) => String(item.application_id) === applicationId)) {
      const needs =
        Boolean(row.needs_confirmation) ||
        ["unclear", "not_met", "not_evaluated", "partial", "needs_confirmation"].includes(
          String(row.state),
        );
      if (!needs) continue;
      const title = String(row.requirement_text || row.explanation || "Confirm eligibility");
      pushItem({
        ...base,
        id: `eligibility:${row.id}`,
        kind: "eligibility",
        title,
        detail: String(row.explanation ?? ""),
        inputLabel: "Add the missing fact or clarification",
        inputType: needsYouInputType(title, "eligibility"),
        payload: {
          eligibilityId: String(row.id),
          profileField: detectProfileMemoryField(`${title} ${row.explanation ?? ""}`),
        },
      });
    }

    const appQuestions = questionsByOpp.get(opportunityId) ?? [];
    for (const question of appQuestions) {
      const answer = latestAnswerByQuestion.get(`${applicationId}:${question.id}`);
      const missingFacts = Array.isArray(answer?.missing_facts)
        ? (answer?.missing_facts as string[]).filter(Boolean)
        : [];
      const approved = Boolean(answer?.approved_text) || String(answer?.state ?? "") === "approved";
      const needsAnswer =
        Boolean(question.required) &&
        (!answer ||
          !approved ||
          ["needs_review", "rejected", "ai_generated"].includes(String(answer.state ?? "")) ||
          missingFacts.length > 0);

      for (const fact of missingFacts) {
        pushItem({
          ...base,
          id: `missing_fact:${applicationId}:${question.id}:${fact}`,
          kind: "missing_fact",
          title: fact,
          detail: `Needed for: ${String(question.prompt)}`,
          inputLabel: "Store this in Application Memory",
          inputType: needsYouInputType(fact, "missing_fact"),
          payload: {
            questionId: String(question.id),
            answerId: answer ? String(answer.id) : null,
            profileField: detectProfileMemoryField(fact),
          },
        });
      }

      if (needsAnswer) {
        const prompt = String(question.prompt);
        pushItem({
          ...base,
          id: `answer:${applicationId}:${question.id}`,
          kind: "answer",
          title: prompt,
          detail: missingFacts.length
            ? `Missing memory: ${missingFacts.slice(0, 3).join("; ")}`
            : answer
              ? `Current state: ${String(answer.state).replace(/_/g, " ")}`
              : "No answer drafted yet — write one or let the platform draft after you add facts.",
          inputLabel: "Your answer",
          inputType: "textarea",
          payload: {
            questionId: String(question.id),
            answerId: answer ? String(answer.id) : null,
          },
        });
      }
    }

    const attachedLabels = attachedLabelsByApp.get(applicationId) ?? new Set<string>();
    for (const doc of (requiredDocuments ?? []).filter(
      (row) => String(row.opportunity_id) === opportunityId && Boolean(row.required),
    )) {
      const label = String(doc.label);
      if (attachedLabels.has(label.toLowerCase())) continue;
      pushItem({
        ...base,
        id: `document:${applicationId}:${doc.id}`,
        kind: "document",
        title: label,
        detail: "Required for this application, but not attached from Application Memory yet.",
        inputLabel: "Attach an existing document",
        inputType: "document",
        payload: { requiredLabel: label },
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

      pushItem({
        ...base,
        id: `mapping:${mapping.id}`,
        kind: "field_mapping",
        title,
        detail: value
          ? `Proposed “${value.slice(0, 120)}” needs confirmation (confidence ${Number(mapping.confidence ?? 0).toFixed(2)}).`
          : "The platform has no memory for this form question yet.",
        inputLabel: "Value to store and use",
        inputType: needsYouInputType(title, "field_mapping"),
        payload: {
          mappingId: String(mapping.id),
          profileField: detectProfileMemoryField(title),
        },
      });
    }

    const fit = (fitRows ?? []).find((row) => String(row.application_id) === applicationId);
    const missing = Array.isArray(fit?.missing) ? (fit?.missing as string[]) : [];
    for (const gap of missing.slice(0, 8)) {
      pushItem({
        ...base,
        id: `fit:${applicationId}:${gap}`,
        kind: "missing_fact",
        title: gap,
        detail: "Flagged by Fit Index as missing from Application Memory.",
        inputLabel: "Add this to Application Memory",
        inputType: needsYouInputType(gap, "missing_fact"),
        payload: { profileField: detectProfileMemoryField(gap) },
      });
    }
  }

  // Prefer unique-ish titles per application: drop duplicate missing_fact that matches eligibility title
  const deduped: NeedsYouItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.applicationId}:${item.kind}:${item.title.toLowerCase().slice(0, 160)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  const byKind: Record<string, number> = {};
  for (const item of deduped) {
    byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
  }

  return {
    items: deduped,
    documents: (documents ?? []).map((doc) => ({
      id: String(doc.id),
      label: String(doc.label),
      type: String(doc.type),
      currentVersionId: (doc.current_version_id as string | null) ?? null,
    })),
    counts: { total: deduped.length, byKind },
  };
}
