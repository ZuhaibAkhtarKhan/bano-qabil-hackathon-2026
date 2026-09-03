"use server";

import { revalidatePath } from "next/cache";

import { applicationStatusSchema } from "@1apply/contracts";
import {
  classifyRequirementKind,
  evaluateSubmissionGuard,
  isDeadlineInPast,
  parseDeadlineLocalInput,
  parsePersona,
  type SubmissionInput,
} from "@1apply/domain";

import { canTransitionTo, normalizeApplicationStatus } from "@/lib/application-workflow";
import { isNeedsYouSystemNoise } from "@/lib/needs-you";
import { recordApplicationEvent } from "@/services/platform";
import { recordAuditEvent } from "@/server/audit";
import { emitDomainEvent } from "@/server/notifications/service";
import { requireWorkspace } from "@/server/auth/require-workspace";
import { finalizeGroundedDraft, freezeSubmissionManifest, lengthWarnings } from "@1apply/domain";
import type { NeedsYouActionResult } from "@/server/needs-you/actions";
import { redirectWith, type ErrorCode } from "@/server/http/flash";
import { syncHostAutomationForApplication } from "@/server/applications/host-automation-schedule";
import { evaluateApplicationIntelligence } from "@/server/intelligence/evaluate";
import { runOwnedJob } from "@/infra/jobs/runner";
import { mapEvidence } from "@/server/memory/map-evidence";
import type { EvidenceRow } from "@/server/types";

function applicationPath(id: string) {
  return `/app/applications/${id}`;
}

function revalidateApplication(id: string) {
  revalidatePath("/app");
  revalidatePath("/app/applications");
  revalidatePath("/app/needs-you");
  revalidatePath(applicationPath(id));
}

function revalidateAfterApplicationDeleted(applicationId: string, opportunityId: string | null) {
  revalidatePath("/app");
  revalidatePath("/app/applications");
  revalidatePath("/app/needs-you");
  revalidatePath("/app/notifications");
  revalidatePath("/app/opportunities");
  revalidatePath(applicationPath(applicationId));
  if (opportunityId) {
    revalidatePath(`/app/opportunities/${opportunityId}`);
  }
}

async function loadEvidence(
  supabase: Awaited<ReturnType<typeof requireWorkspace>>["supabase"],
  userId: string,
) {
  const { data } = await supabase
    .from("evidence_items")
    .select(
      "id, title, kind, organization, situation, action, outcome, skills, verification_status, excluded_from_ai, start_date, end_date",
    )
    .eq("user_id", userId);
  return ((data ?? []) as EvidenceRow[]).map(mapEvidence);
}

async function notify(
  supabase: Awaited<ReturnType<typeof requireWorkspace>>["supabase"],
  actor: { userId: string },
  applicationId: string,
  title: string,
  body: string,
  name: Parameters<typeof emitDomainEvent>[1]["name"],
) {
  await emitDomainEvent(
    supabase,
    {
      name,
      userId: actor.userId,
      applicationId,
      subjectId: `${applicationId}:${name}`,
      title,
      body,
    },
    { recordTimeline: false },
  );
}

export async function addRequirement(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  const { data: application } = await supabase
    .from("applications")
    .select("id, opportunity_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (!application || !text) {
    redirectWith(applicationPath(applicationId || ""), { error: "required" }, "eligibility");
  }

  await supabase.from("requirements").insert({
    user_id: user.id,
    opportunity_id: application.opportunity_id,
    text,
    hard: String(formData.get("hard") ?? "") === "on",
    kind: classifyRequirementKind(text),
    confidence: 1,
    source_span: "manual",
  });

  revalidateApplication(applicationId);
  redirectWith(applicationPath(applicationId), { notice: "saved" }, "eligibility");
}

export async function addQuestion(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!applicationId || !prompt) {
    redirectWith(applicationPath(applicationId || ""), { error: "required" }, "answers");
  }

  const { data: application } = await supabase
    .from("applications")
    .select("id, opportunity_id")
    .eq("id", applicationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!application) {
    redirectWith("/app/applications", { error: "not_found" });
  }

  const { count } = await supabase
    .from("opportunity_questions")
    .select("id", { count: "exact", head: true })
    .eq("opportunity_id", application.opportunity_id);

  await supabase.from("opportunity_questions").insert({
    user_id: user.id,
    opportunity_id: application.opportunity_id,
    prompt,
    limit_value: Number(formData.get("limitValue") || 0) || null,
    limit_unit: String(formData.get("limitUnit") ?? "").trim() || null,
    sort_order: count ?? 0,
    source: "manual",
  });

  const { count: applicationCount } = await supabase
    .from("application_questions")
    .select("id", { count: "exact", head: true })
    .eq("application_id", applicationId);

  await supabase.from("application_questions").insert({
    user_id: user.id,
    application_id: applicationId,
    prompt,
    limit_value: Number(formData.get("limitValue") || 0) || null,
    limit_unit: String(formData.get("limitUnit") ?? "").trim() || null,
    sort_order: applicationCount ?? 0,
    source: "manual",
  });

  revalidateApplication(applicationId);
  redirectWith(applicationPath(applicationId), { notice: "saved" }, "answers");
}

function parseDeadlineInput(value: string, timezone: string | null = null): string | null {
  return parseDeadlineLocalInput(value, timezone);
}

export async function updateApplicationPersona(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const persona = parsePersona(String(formData.get("persona") ?? "").trim()) ?? null;
  const { data: application } = await supabase
    .from("applications")
    .select("id")
    .eq("id", applicationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!application) {
    redirectWith("/app/applications", { error: "not_found" });
  }

  const { error } = await supabase.from("applications").update({ persona }).eq("id", applicationId);
  if (error) {
    redirectWith(applicationPath(applicationId), { error: "save" });
  }

  revalidateApplication(applicationId);
  redirectWith(applicationPath(applicationId), { notice: "saved" }, "opportunity");
}

export async function updateApplicationSchedule(formData: FormData) {
  const { user, supabase, actor } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const timezone = String(formData.get("timezone") ?? "").trim() || null;
  const deadlineAt = parseDeadlineInput(String(formData.get("deadline") ?? ""), timezone);
  if (deadlineAt && isDeadlineInPast(deadlineAt)) {
    redirectWith(applicationPath(applicationId), { error: "deadline_past" }, "opportunity");
  }
  const { data: application } = await supabase
    .from("applications")
    .select("id")
    .eq("id", applicationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!application) {
    redirectWith("/app/applications", { error: "not_found" });
  }

  const { error } = await supabase
    .from("applications")
    .update({ deadline_at: deadlineAt, deadline_timezone: timezone })
    .eq("id", applicationId);
  if (error) {
    redirectWith(applicationPath(applicationId), { error: "save" }, "opportunity");
  }

  await syncHostAutomationForApplication({
    supabase,
    actor,
    applicationId,
    queuePrefill: false,
  });

  revalidateApplication(applicationId);
  redirectWith(applicationPath(applicationId), { notice: "saved" }, "opportunity");
}

export async function analyzeApplication(formData: FormData) {
  const { user, supabase, actor } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const { data: application } = await supabase
    .from("applications")
    .select("id, opportunity_id, status")
    .eq("id", applicationId)
    .maybeSingle();
  if (!application) {
    redirectWith("/app/applications", { error: "not_found" });
  }

  await runOwnedJob(
    supabase,
    { actor, type: "eligibility_evaluate", inputRef: applicationId },
    async () => {
      const { eligibility } = await evaluateApplicationIntelligence(
        supabase,
        actor,
        applicationId,
        application.opportunity_id,
      );

      await supabase.from("review_items").delete().eq("application_id", applicationId).eq("resolved", false);
      const review = eligibility
        .filter(
          (item) =>
            item.requirementId !== "none" &&
            !isNeedsYouSystemNoise(String(item.explanation ?? "")) &&
            !isNeedsYouSystemNoise(String(item.requirementText ?? "")) &&
            (item.state === "unclear" ||
              item.state === "not_met" ||
              item.state === "not_evaluated" ||
              item.state === "partial"),
        )
        .map((item) => ({
          user_id: user.id,
          application_id: applicationId,
          kind: "eligibility",
          prompt: item.explanation,
          resolved: false,
        }));
      if (review.length > 0) {
        await supabase.from("review_items").insert(review);
      }

      const hardMiss = eligibility.some((item) => item.hard && item.state === "not_met");
      await supabase
        .from("applications")
        .update({
          status: normalizeApplicationStatus(application.status) === "saved" ? "analyzing" : application.status,
          next_action: hardMiss
            ? "Hard eligibility is not satisfied — review before applying"
            : review.length > 0
              ? "Resolve eligibility gaps and confirm missing evidence"
              : "Select a resume, review generated answers, and prepare submission",
        })
        .eq("id", applicationId);

      await recordApplicationEvent(supabase, actor, applicationId, "application.analyzed", {
        reviewCount: review.length,
        hardMiss,
      });

      await notify(
        supabase,
        actor,
        applicationId,
        "Intelligence updated",
        "Eligibility, Fit Index, and resume matching ran as three separate systems on verified evidence only.",
        "intelligence.updated",
      );
    },
  );

  revalidateApplication(applicationId);
  redirectWith(applicationPath(applicationId), { notice: "fit_analyzed" }, "fit");
}


export async function saveManualAnswer(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const questionId = String(formData.get("questionId") ?? "");
  const text = String(formData.get("text") ?? "");
  const citedIds = formData.getAll("evidenceId").map((value) => String(value));
  const { data: question } = await supabase
    .from("application_questions")
    .select("id, prompt, limit_value, limit_unit, application_id")
    .eq("id", questionId)
    .maybeSingle();
  if (!question || question.application_id !== applicationId) {
    redirectWith(applicationPath(applicationId), { error: "not_found" }, "answers");
  }

  const evidence = await loadEvidence(supabase, user.id);
  const allowedIds = evidence
    .filter((item) => item.verificationStatus === "verified" && !item.excludedFromAi)
    .map((item) => item.id);

  const draft = finalizeGroundedDraft({
    text,
    citedIds,
    allowedIds,
    warnings: lengthWarnings(text, question.limit_value, question.limit_unit),
  });

  await supabase.from("answer_versions").insert({
    user_id: user.id,
    question_id: questionId,
    text: draft.text,
    evidence_ids: draft.evidenceIds,
    missing_facts: draft.missingFacts,
    warnings: draft.warnings,
    approved: false,
    model: null,
    prompt_version: "manual-v1",
  });

  revalidateApplication(applicationId);
  redirectWith(
    applicationPath(applicationId),
    { notice: draft.warnings.includes("NO_EVIDENCE") ? "no_evidence" : "drafted" },
    "answers",
  );
}

export async function approveAnswer(formData: FormData) {
  const { supabase } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const versionId = String(formData.get("versionId") ?? "");
  const { data: version } = await supabase
    .from("answer_versions")
    .select("id, question_id, text, evidence_ids")
    .eq("id", versionId)
    .maybeSingle();
  if (!version) {
    redirectWith(applicationPath(applicationId), { error: "not_found" }, "answers");
  }
  if (!version.text.trim() || (version.evidence_ids ?? []).length === 0) {
    redirectWith(applicationPath(applicationId), { error: "grounding" }, "answers");
  }

  await supabase.from("answer_versions").update({ approved: false }).eq("question_id", version.question_id).eq("approved", true);
  await supabase.from("answer_versions").update({ approved: true }).eq("id", versionId);

  const { count: questionCount } = await supabase
    .from("application_questions")
    .select("id", { count: "exact", head: true })
    .eq("application_id", applicationId);
  const { data: approvedRows } = await supabase
    .from("answer_versions")
    .select("id, question_id")
    .eq("approved", true);
  const { data: appQuestions } = await supabase
    .from("application_questions")
    .select("id")
    .eq("application_id", applicationId);
  const approvedCount = (appQuestions ?? []).filter((item) =>
    (approvedRows ?? []).some((row) => row.question_id === item.id),
  ).length;

  if ((questionCount ?? 0) > 0 && approvedCount === (questionCount ?? 0)) {
    await supabase
      .from("applications")
      .update({ status: "ready", next_action: "Review and mark submitted when you have sent it yourself" })
      .eq("id", applicationId)
      .in("status", ["draft", "preparing"]);
  }

  revalidateApplication(applicationId);
  redirectWith(applicationPath(applicationId), { notice: "approved" }, "answers");
}

export async function attachDocument(formData: FormData) {
  const { user, supabase, actor } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");
  const requestedVersionId = String(formData.get("versionId") ?? "").trim() || null;

  const { data: document } = await supabase
    .from("documents")
    .select("id, current_version_id")
    .eq("id", documentId)
    .eq("user_id", user.id)
    .maybeSingle();

  const versionId = requestedVersionId ?? document?.current_version_id ?? null;
  if (!document || !versionId) {
    redirectWith(applicationPath(applicationId), { error: "required" }, "documents");
  }

  const { data: version } = await supabase
    .from("document_versions")
    .select("id, document_id")
    .eq("id", versionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!version || version.document_id !== documentId) {
    redirectWith(applicationPath(applicationId), { error: "not_found" }, "documents");
  }

  await supabase.from("application_documents").delete().eq("application_id", applicationId).eq("document_id", documentId);
  await supabase.from("application_documents").insert({
    user_id: user.id,
    application_id: applicationId,
    document_id: documentId,
    document_version_id: versionId,
  });

  await recordApplicationEvent(supabase, actor, applicationId, "document.attached", {
    documentId,
    versionId,
  });

  revalidateApplication(applicationId);
  redirectWith(applicationPath(applicationId), { notice: "attached" }, "documents");
}

export async function markSubmitted(formData: FormData) {
  const { user, supabase, actor } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const { data: application } = await supabase
    .from("applications")
    .select("id, status, deadline_at, opportunity_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (!application) {
    redirectWith("/app/applications", { error: "not_found" });
  }
  if (application.status === "submitted") {
    redirectWith(applicationPath(applicationId), { notice: "already_submitted" }, "review");
  }

  const [
    { data: questions },
    { data: attached },
    { data: answers },
    { data: opportunity },
    { data: mappings },
    { data: eligibilityResults },
    { data: reviewItems },
    { data: snapshots },
    { data: fitRow },
    { data: resumeMatches },
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
    supabase.from("eligibility_results").select("state, explanation").eq("application_id", applicationId),
    supabase.from("review_items").select("resolved, prompt").eq("application_id", applicationId),
    supabase.from("submission_snapshots").select("id").eq("application_id", applicationId),
    supabase.from("fit_evaluations").select("score, missing").eq("application_id", applicationId).maybeSingle(),
    supabase.from("resume_matches").select("document_id, recommended").eq("application_id", applicationId),
  ]);

  const approvedByQuestion = new Map(
    (answers ?? [])
      .filter((row) => Boolean(row.approved_text))
      .map((row) => [row.question_id as string, row.id as string]),
  );

  const recommended = (resumeMatches ?? []).find(
    (item) => (item as { recommended?: boolean }).recommended,
  );

  const guardInput: SubmissionInput = {
    applicationId,
    status: application.status,
    questions: (questions ?? []).map((q) => ({ id: q.id, prompt: q.prompt })),
    approvedAnswerIds: approvedByQuestion,
    attachedDocumentIds: (attached ?? []).map((item) => item.document_id as string),
    resumeMatchRecommended: recommended ? (recommended.document_id as string) : null,
    eligibilityResults: (eligibilityResults ?? []).map((e) => ({
      state: e.state as string,
      explanation: e.explanation as string,
    })),
    reviewItems: (reviewItems ?? []).map((r) => ({
      resolved: r.resolved as boolean,
      prompt: r.prompt as string,
    })),
    snapshots: (snapshots ?? []).map((s) => ({ id: s.id as string })),
    fitScore: fitRow?.score as number | null ?? null,
    fitMissing: (fitRow?.missing as string[]) ?? [],
    hasSignatureField: false,
    hasPaymentField: false,
    hasCaptcha: false,
    hasSecurityChallenge: false,
    userAuthenticated: true,
  };

  const guard = evaluateSubmissionGuard(guardInput);

  await supabase.from("submission_attempts").insert({
    user_id: user.id,
    application_id: applicationId,
    idempotency_key: guard.idempotencyKey,
    status: guard.safe ? "pending" : "failed",
    guard_result: guard,
    error_message: guard.safe
      ? null
      : guard.blockers.map((b) => b.reason).join("; "),
  });

  if (!guard.safe) {
    const blockerText = guard.blockers.map((b) => `${b.label}: ${b.reason}`).join("\n");
    await notify(
      supabase,
      actor,
      applicationId,
      "Submission blocked",
      `${guard.blockers.length} blocking issue(s) prevent submission:\n${blockerText}`,
      "submission.failed",
    );
    revalidateApplication(applicationId);
    redirectWith(applicationPath(applicationId), { error: "snapshot" }, "review");
  }

  const { data: duplicateAttempt } = await supabase
    .from("submission_attempts")
    .select("id")
    .eq("application_id", applicationId)
    .eq("idempotency_key", guard.idempotencyKey)
    .eq("status", "completed")
    .maybeSingle();

  if (duplicateAttempt) {
    await supabase
      .from("submission_attempts")
      .update({ status: "duplicate" })
      .eq("application_id", applicationId)
      .eq("idempotency_key", guard.idempotencyKey)
      .neq("status", "completed");

    await notify(
      supabase,
      actor,
      applicationId,
      "Duplicate submission prevented",
      "An identical submission already exists. No new snapshot was created.",
      "submission.failed",
    );
    revalidateApplication(applicationId);
    redirectWith(applicationPath(applicationId), { notice: "already_submitted" }, "review");
  }

  const unanswered = (questions ?? []).filter((question) => !approvedByQuestion.has(question.id));
  if (unanswered.length > 0) {
    await notify(
      supabase,
      actor,
      applicationId,
      "Unanswered questions were not auto-submitted",
      `${unanswered.length} question(s) had no approved answer. 1-Apply never submits on your behalf.`,
      "answer.needs_review",
    );
  }

  const snapshot = freezeSubmissionManifest({
    answers: (answers ?? [])
      .filter((row) => Boolean(row.approved_text))
      .map((row) => ({
        questionId: row.question_id as string,
        answerVersionId: row.id as string,
        prompt: (questions ?? []).find((question) => question.id === row.question_id)?.prompt ?? "",
        text: String(row.approved_text),
      })),
    documents: (attached ?? []).map((item) => ({
      documentId: item.document_id as string,
      documentVersionId: item.document_version_id as string,
    })),
  });

  const { data: snapshotRow, error } = await supabase
    .from("submission_snapshots")
    .insert({
      user_id: user.id,
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
      evidence_manifest: (answers ?? [])
        .filter((row) => Boolean(row.approved_text))
        .map((row) => ({
          questionId: row.question_id,
          evidenceIds: row.evidence_ids ?? [],
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
      idempotency_key: guard.idempotencyKey,
      guard_result: guard,
    })
    .select("id")
    .single();
  if (error) {
    await supabase
      .from("submission_attempts")
      .update({ status: "failed", error_message: error.message })
      .eq("application_id", applicationId)
      .eq("idempotency_key", guard.idempotencyKey)
      .eq("status", "pending");

    redirectWith(applicationPath(applicationId), { error: "snapshot" }, "review");
  }

  await supabase
    .from("submission_attempts")
    .update({ status: "completed", snapshot_id: snapshotRow.id })
    .eq("application_id", applicationId)
    .eq("idempotency_key", guard.idempotencyKey)
    .eq("status", "pending");

  await supabase
    .from("applications")
    .update({
      next_action: "Packet frozen. 1-Apply has not submitted the host form.",
    })
    .eq("id", applicationId)
    .neq("status", "submitted");

  await recordApplicationEvent(supabase, actor, applicationId, "application.submitted_snapshot", {
    answers: snapshot.answerManifest.length,
    documents: snapshot.documentManifest.length,
    hostSubmitClicked: false,
  });

  await notify(
    supabase,
    actor,
    applicationId,
    "Submission snapshot frozen",
    `Approved answers and attached document versions were recorded. Guard passed ${guard.checks.filter((c) => c.passed).length}/${guard.checks.length} checks. The host form was not submitted.`,
    "intelligence.updated",
  );

  revalidateApplication(applicationId);
  redirectWith(applicationPath(applicationId), { notice: "saved" }, "review");
}

export async function updateApplicationStatus(formData: FormData) {
  const { supabase, actor } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const parsed = applicationStatusSchema.safeParse(String(formData.get("status") ?? ""));
  if (!parsed.success) {
    redirectWith(applicationPath(applicationId), { error: "required" }, "review");
  }

  const { data: application } = await supabase
    .from("applications")
    .select("id, status")
    .eq("id", applicationId)
    .maybeSingle();
  if (!application) {
    redirectWith(applicationPath(applicationId), { error: "not_found" }, "review");
  }
  if (!canTransitionTo(application.status, normalizeApplicationStatus(parsed.data))) {
    redirectWith(applicationPath(applicationId), { error: "required" }, "review");
  }

  await supabase
    .from("applications")
    .update({
      status: parsed.data,
      next_action:
        parsed.data === "submitted"
          ? "Marked submitted by you. Confirm the host actually received the form."
          : `Continue from ${parsed.data}`,
    })
    .eq("id", applicationId);

  await recordApplicationEvent(supabase, actor, applicationId, "application.status_updated", {
    from: application.status,
    to: parsed.data,
  });
  await emitDomainEvent(supabase, {
    name: "application.status_changed",
    userId: actor.userId,
    applicationId,
    subjectId: `${applicationId}:status:${parsed.data}`,
    title: `Application status: ${parsed.data.replace(/_/g, " ")}`,
    body: `Moved from ${String(application.status).replace(/_/g, " ")} to ${parsed.data.replace(/_/g, " ")}.`,
    payload: { from: application.status, to: parsed.data },
  }, { recordTimeline: false });

  revalidateApplication(applicationId);
  redirectWith(applicationPath(applicationId), { notice: "status_updated" }, "review");
}

export async function resolveReviewItem(formData: FormData) {
  const { supabase } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  await supabase.from("review_items").update({ resolved: true }).eq("id", itemId);
  revalidateApplication(applicationId);
  redirectWith(applicationPath(applicationId), { notice: "saved" }, "review");
}

export type DeleteApplicationResult = { ok: true } | { ok: false; error: ErrorCode };

async function deleteApplicationImpl(
  supabase: Awaited<ReturnType<typeof requireWorkspace>>["supabase"],
  userId: string,
  applicationId: string,
): Promise<DeleteApplicationResult> {
  if (!applicationId) {
    return { ok: false, error: "required" };
  }

  const { data: application } = await supabase
    .from("applications")
    .select("id, opportunity_id")
    .eq("id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!application) {
    return { ok: false, error: "not_found" };
  }

  const opportunityId = (application.opportunity_id as string | null) ?? null;

  await recordAuditEvent(supabase, "application.deleted", {
    applicationId,
    opportunityId,
  });

  await supabase
    .from("jobs")
    .update({ state: "failed", error_code: "APPLICATION_DELETED" })
    .eq("user_id", userId)
    .eq("input_ref", applicationId)
    .in("state", ["queued", "running", "processing"]);

  await supabase
    .from("notifications")
    .update({
      read_at: new Date().toISOString(),
      action_url: "/app/applications",
    })
    .eq("user_id", userId)
    .eq("action_url", `/app/applications/${applicationId}`);

  const { error } = await supabase
    .from("applications")
    .delete()
    .eq("id", applicationId)
    .eq("user_id", userId);

  if (error) {
    return { ok: false, error: "save" };
  }

  if (opportunityId) {
    await supabase.from("opportunities").delete().eq("id", opportunityId).eq("user_id", userId);
  }

  revalidateAfterApplicationDeleted(applicationId, opportunityId);
  return { ok: true };
}

/** Client-callable delete — returns a result instead of redirecting. */
export async function deleteApplicationAction(formData: FormData): Promise<NeedsYouActionResult> {
  const { user, supabase } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const result = await deleteApplicationImpl(supabase, user.id, applicationId);
  if (!result.ok) return result;
  return { ok: true, notice: "application_deleted" };
}

export async function deleteApplication(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const nextRaw = String(formData.get("next") ?? "").trim();
  const next =
    nextRaw === "/app/needs-you" || nextRaw.startsWith("/app/applications")
      ? nextRaw
      : "/app/applications";

  const result = await deleteApplicationImpl(supabase, user.id, applicationId);
  if (!result.ok) {
    const path = result.error === "save" ? applicationPath(applicationId) : next;
    redirectWith(path, { error: result.error });
  }
  redirectWith(next, { notice: "application_deleted" });
}

/** Edit a filled autofill / Need You / memory mapping before host submit. */
export async function updateApplicationFieldMapping(formData: FormData) {
  const { user, supabase, actor } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "").trim();
  const mappingId = String(formData.get("mappingId") ?? "").trim();
  const value = String(formData.get("value") ?? "").trim();

  if (!applicationId || !mappingId) {
    redirectWith(applicationPath(applicationId || ""), { error: "required" });
  }

  const { data: application } = await supabase
    .from("applications")
    .select("id, status")
    .eq("id", applicationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!application) redirectWith("/app/applications", { error: "not_found" });
  if (["submitted", "rejected", "withdrawn", "archived", "offer"].includes(String(application.status))) {
    redirectWith(applicationPath(applicationId), { error: "save" });
  }

  const { data: mapping } = await supabase
    .from("field_mappings")
    .select("id, field_key, label")
    .eq("id", mappingId)
    .eq("application_id", applicationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!mapping) redirectWith(applicationPath(applicationId), { error: "not_found" });

  await supabase
    .from("field_mappings")
    .update({
      value: value.slice(0, 4000),
      source: "Application tab edit",
      confidence: value ? 1 : 0.2,
      excluded_by_default: !value,
      label: String(mapping.label ?? "Field").slice(0, 180),
    })
    .eq("id", mappingId)
    .eq("user_id", user.id);

  const { data: siblings } = await supabase
    .from("field_mappings")
    .select("id, field_key, label, value, source, confidence, excluded_by_default")
    .eq("application_id", applicationId)
    .eq("user_id", user.id);
  const { dedupeFieldMappings } = await import("@/lib/field-mappings");
  const winners = new Set(
    dedupeFieldMappings(
      (siblings ?? []).map((row) =>
        String(row.id) === mappingId
          ? {
              ...row,
              value,
              confidence: value ? 1 : 0.2,
              excluded_by_default: !value,
              source: "Application tab edit",
            }
          : row,
      ),
    ).map((row) => String(row.id)),
  );
  const siblingIds = (siblings ?? [])
    .map((row) => String(row.id))
    .filter((id) => id !== mappingId && !winners.has(id));
  if (siblingIds.length) {
    await supabase.from("field_mappings").delete().eq("user_id", user.id).in("id", siblingIds);
  }

  await recordApplicationEvent(supabase, actor, applicationId, "field_mapping.updated", {
    mappingId,
    fieldKey: mapping.field_key,
  });

  const { tryNoDeadlineHostSubmitIfComplete } = await import(
    "@/server/applications/host-automation-schedule"
  );
  await tryNoDeadlineHostSubmitIfComplete({ supabase, actor, applicationId });

  revalidateApplication(applicationId);
  redirectWith(`${applicationPath(applicationId)}#autofill`, { notice: "saved" });
}

