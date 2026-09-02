import type { SupabaseClient } from "@supabase/supabase-js";

import {
  answerTextForTracker,
  buildTrackerRequiredLabels,
  buildTrackerVaultDocs,
  trackerDocumentStatuses,
} from "@/lib/application-tracker-documents";
import type { DashboardDocStatus } from "@/lib/dashboard-display";

export type ApplicationTrackerDocumentContext = {
  requiredDocumentLabels: string[];
  resume: DashboardDocStatus;
  cover: DashboardDocStatus;
};

type RawApplicationRow = {
  id: string;
  opportunity_id: string;
};

/** Batch-load resume/cover tracker state for dashboard + applications list. */
export async function loadApplicationTrackerDocumentMaps(
  supabase: SupabaseClient,
  userId: string,
  applications: RawApplicationRow[],
): Promise<Map<string, ApplicationTrackerDocumentContext>> {
  const byApplication = new Map<string, ApplicationTrackerDocumentContext>();
  const applicationIds = applications.map((row) => row.id);
  const opportunityIds = [
    ...new Set(applications.map((row) => row.opportunity_id).filter((id): id is string => Boolean(id))),
  ];

  if (applicationIds.length === 0) return byApplication;

  const [
    { data: requiredDocs },
    { data: attachedRows },
    { data: userDocuments },
    { data: fieldMappings },
    { data: answers },
    { data: questions },
  ] = await Promise.all([
    opportunityIds.length > 0
      ? supabase
          .from("opportunity_documents")
          .select("opportunity_id, label, required")
          .eq("user_id", userId)
          .in("opportunity_id", opportunityIds)
      : Promise.resolve({ data: [] as Array<{ opportunity_id: string; label: string; required: boolean }> }),
    supabase
      .from("application_documents")
      .select("application_id, document_id")
      .eq("user_id", userId)
      .in("application_id", applicationIds),
    supabase.from("documents").select("id, label, type").eq("user_id", userId),
    supabase
      .from("field_mappings")
      .select("application_id, label, value, field_type")
      .eq("user_id", userId)
      .in("application_id", applicationIds),
    supabase
      .from("application_answers")
      .select("application_id, question_id, approved_text, user_edited_text, original_ai_text")
      .eq("user_id", userId)
      .in("application_id", applicationIds),
    opportunityIds.length > 0
      ? supabase
          .from("opportunity_questions")
          .select("id, opportunity_id, prompt, required")
          .eq("user_id", userId)
          .in("opportunity_id", opportunityIds)
      : Promise.resolve({
          data: [] as Array<{ id: string; opportunity_id: string; prompt: string; required: boolean | null }>,
        }),
  ]);

  const requiredDocsByOpportunity = new Map<string, string[]>();
  for (const row of requiredDocs ?? []) {
    if (!row.required) continue;
    const list = requiredDocsByOpportunity.get(String(row.opportunity_id)) ?? [];
    list.push(String(row.label));
    requiredDocsByOpportunity.set(String(row.opportunity_id), list);
  }

  const docMeta = new Map(
    (userDocuments ?? []).map((doc) => [
      String(doc.id),
      { label: String(doc.label ?? ""), type: String(doc.type ?? "") },
    ]),
  );

  const attachedMetaByApplication = new Map<string, Array<{ label: string; type: string }>>();
  for (const row of attachedRows ?? []) {
    const meta = docMeta.get(String(row.document_id));
    if (!meta) continue;
    const list = attachedMetaByApplication.get(String(row.application_id)) ?? [];
    list.push(meta);
    attachedMetaByApplication.set(String(row.application_id), list);
  }

  const mappingsByApplication = new Map<string, Array<{ label: string; value: string; fieldType?: string | null }>>();
  for (const row of fieldMappings ?? []) {
    const list = mappingsByApplication.get(String(row.application_id)) ?? [];
    list.push({
      label: String(row.label ?? ""),
      value: String(row.value ?? ""),
      fieldType: typeof row.field_type === "string" ? row.field_type : null,
    });
    mappingsByApplication.set(String(row.application_id), list);
  }

  const questionsById = new Map(
    (questions ?? []).map((row) => [
      String(row.id),
      { prompt: String(row.prompt ?? ""), required: row.required },
    ]),
  );
  const questionsByOpportunity = new Map<string, Array<{ prompt: string; required?: boolean | null }>>();
  for (const row of questions ?? []) {
    const list = questionsByOpportunity.get(String(row.opportunity_id)) ?? [];
    list.push({ prompt: String(row.prompt ?? ""), required: row.required });
    questionsByOpportunity.set(String(row.opportunity_id), list);
  }

  const answersByApplication = new Map<string, Array<{ prompt: string; text: string | null }>>();
  for (const row of answers ?? []) {
    const question = questionsById.get(String(row.question_id));
    if (!question) continue;
    const list = answersByApplication.get(String(row.application_id)) ?? [];
    list.push({
      prompt: question.prompt,
      text: answerTextForTracker(row),
    });
    answersByApplication.set(String(row.application_id), list);
  }

  for (const application of applications) {
    const requiredLabels = buildTrackerRequiredLabels({
      opportunityDocLabels: requiredDocsByOpportunity.get(application.opportunity_id) ?? [],
      mappingLabels: (mappingsByApplication.get(application.id) ?? []).map((row) => row.label),
      questionPrompts: questionsByOpportunity.get(application.opportunity_id) ?? [],
    });
    const vault = buildTrackerVaultDocs({
      attachedMeta: attachedMetaByApplication.get(application.id) ?? [],
      mappings: mappingsByApplication.get(application.id) ?? [],
      answers: answersByApplication.get(application.id) ?? [],
    });
    const statuses = trackerDocumentStatuses(requiredLabels, vault);
    byApplication.set(application.id, {
      requiredDocumentLabels: requiredLabels,
      resume: statuses.resume,
      cover: statuses.cover,
    });
  }

  return byApplication;
}
