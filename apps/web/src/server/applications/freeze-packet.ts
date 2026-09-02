import { freezeSubmissionManifest, packetAnswerText } from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { emitDomainEvent } from "@/server/notifications/service";
import { recordApplicationEvent } from "@/services/platform";

export async function freezeApplicationPacket(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  source: "user" | "silence";
  hostSubmitClicked?: boolean;
}): Promise<{ ok: true; snapshotId: string } | { ok: false; reason: string }> {
  const { supabase, actor, applicationId, source, hostSubmitClicked = false } = input;

  const { data: application } = await supabase
    .from("applications")
    .select("id, status, deadline_at, opportunity_id")
    .eq("id", applicationId)
    .eq("user_id", actor.userId)
    .maybeSingle();
  if (!application) return { ok: false, reason: "not_found" };
  if (application.status === "submitted") return { ok: false, reason: "already_submitted" };

  const [
    { data: questions },
    { data: attached },
    { data: answers },
    { data: opportunity },
    { data: mappings },
    { data: snapshots },
  ] = await Promise.all([
    supabase.from("opportunity_questions").select("id, prompt").eq("opportunity_id", application.opportunity_id),
    supabase
      .from("application_documents")
      .select("document_id, document_version_id")
      .eq("application_id", applicationId),
    supabase
      .from("application_answers")
      .select("id, question_id, approved_text, original_ai_text, user_edited_text, evidence_ids")
      .eq("application_id", applicationId),
    supabase
      .from("opportunities")
      .select("id, title, organization, category, location, source, source_url, deadline_at, raw_excerpt")
      .eq("id", application.opportunity_id)
      .maybeSingle(),
    supabase
      .from("field_mappings")
      .select("field_key, label, value, source, confidence, excluded_by_default")
      .eq("application_id", applicationId),
    supabase.from("submission_snapshots").select("id").eq("application_id", applicationId),
  ]);

  if ((snapshots ?? []).length > 0) return { ok: false, reason: "already_submitted" };

  const packetAnswers = (answers ?? [])
    .map((row) => ({
      id: String(row.id),
      questionId: String(row.question_id),
      text: packetAnswerText({
        approvedText: (row.approved_text as string | null) ?? null,
        userEditedText: (row.user_edited_text as string | null) ?? null,
        originalAiText: (row.original_ai_text as string | null) ?? null,
      }),
      evidenceIds: (row.evidence_ids as string[] | null) ?? [],
    }))
    .filter((row) => Boolean(row.text));

  const snapshot = freezeSubmissionManifest({
    answers: packetAnswers.map((row) => ({
      questionId: row.questionId,
      answerVersionId: row.id,
      prompt: (questions ?? []).find((question) => question.id === row.questionId)?.prompt ?? "",
      text: row.text ?? "",
    })),
    documents: (attached ?? []).map((item) => ({
      documentId: item.document_id as string,
      documentVersionId: item.document_version_id as string,
    })),
  });

  const { data: snapshotRow, error } = await supabase
    .from("submission_snapshots")
    .insert({
      user_id: actor.userId,
      application_id: applicationId,
      submitted_at: snapshot.submittedAt,
      answer_manifest: snapshot.answerManifest,
      document_manifest: snapshot.documentManifest,
      opportunity_snapshot: opportunity
        ? {
            title: opportunity.title,
            organization: opportunity.organization,
            sourceUrl: opportunity.source_url,
            category: opportunity.category,
            location: opportunity.location,
            deadlineAt: opportunity.deadline_at,
            excerpt: (opportunity.raw_excerpt ?? "").slice(0, 2000),
          }
        : {},
      evidence_manifest: packetAnswers.map((row) => ({
        questionId: row.questionId,
        evidenceIds: row.evidenceIds,
      })),
      field_manifest: (mappings ?? []).map((item) => ({
        fieldKey: item.field_key,
        label: item.label,
        value: item.value,
        source: item.source,
        confidence: item.confidence,
        excludedByDefault: item.excluded_by_default,
      })),
      application_status: application.status,
      deadline_at: application.deadline_at,
      idempotency_key: `${applicationId}:packet:${source}:${snapshot.submittedAt.slice(0, 13)}`,
      guard_result: {
        source,
        hostSubmitClicked,
        captchaBypassed: false,
      },
    })
    .select("id")
    .single();

  if (error || !snapshotRow) return { ok: false, reason: error?.message ?? "snapshot" };

  await supabase
    .from("applications")
    .update({
      status: "submitted",
      submitted_at: snapshot.submittedAt,
      next_action: hostSubmitClicked
        ? "Submitted to the host before the deadline."
        : source === "silence"
          ? "Packet frozen at deadline because you did not edit."
          : "Track the host process. 1-Apply did not send this application.",
    })
    .eq("id", applicationId);

  await recordApplicationEvent(supabase, actor, applicationId, "application.submitted_snapshot", {
    answers: snapshot.answerManifest.length,
    documents: snapshot.documentManifest.length,
    source,
  });

  await emitDomainEvent(supabase, {
    name: "submission.completed",
    userId: actor.userId,
    applicationId,
    subjectId: `${applicationId}:packet:${source}`,
    title: hostSubmitClicked
      ? "Form submitted to host"
      : source === "silence"
        ? "Packet frozen at deadline"
        : "Submission snapshot frozen",
    body: hostSubmitClicked
      ? "1-Apply filled and clicked Submit on the host form."
      : source === "silence"
        ? "The current packet was frozen because you did not edit before the deadline."
        : "Approved answers and attached document versions were recorded. You still submit to the host yourself.",
  });

  return { ok: true, snapshotId: String(snapshotRow.id) };
}
