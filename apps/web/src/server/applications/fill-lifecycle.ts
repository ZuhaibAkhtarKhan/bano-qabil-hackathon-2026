import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { memoryFactKey, detectSubmissionSignals } from "@1apply/domain";
import type { FillSessionCapturedField, FillSessionEndReason } from "@1apply/contracts";

import type { Actor } from "@/auth/actor";
import { runOwnedJob } from "@/infra/jobs/runner";
import {
  APPLICATION_LIFECYCLE_ACTIONS,
} from "@/lib/application-lifecycle";
import { detectProfileMemoryField, isNeedsYouSystemNoise, isStructuredFormFieldPrompt } from "@/lib/needs-you";
import { refreshOpenApplicationsFromKit } from "@/server/applications/refresh-from-kit";
import { logError } from "@/lib/log";
import { generateAnswer } from "@/server/answers/generate";
import { recordAuditEvent } from "@/server/audit";
import { evaluateApplicationIntelligence } from "@/server/intelligence/evaluate";
import { syncMemoryConflicts } from "@/server/memory/persist-extraction";
import { emitDomainEvent } from "@/server/notifications/service";
import { recordApplicationEvent } from "@/services/platform";
import { fetchPublicPageText } from "@/server/ingest/fetch-page";

function revalidateLifecycle(applicationId: string) {
  revalidatePath("/app");
  revalidatePath("/app/applications");
  revalidatePath("/app/needs-you");
  revalidatePath("/app/notifications");
  revalidatePath(`/app/applications/${applicationId}`);
}

async function notifyLifecycle(
  supabase: SupabaseClient,
  actor: Actor,
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
      subjectId: `${applicationId}:${name}:${Date.now()}`,
      title,
      body,
    },
    { recordTimeline: false },
  );
}

async function storeCapturedFieldsInMemory(
  supabase: SupabaseClient,
  userId: string,
  fields: FillSessionCapturedField[],
): Promise<number> {
  let saved = 0;
  for (const field of fields) {
    const value = field.value.trim();
    if (!value) continue;
    const label = field.label.trim() || field.fieldKey;
    const profileField = detectProfileMemoryField(`${label} ${field.fieldKey}`);
    const factKey = memoryFactKey({
      category: "personal",
      title: label.slice(0, 80),
      field: profileField ?? field.fieldKey.slice(0, 40),
    });

    const { error } = await supabase.from("profile_facts").insert({
      user_id: userId,
      category: "personal",
      fact_type: profileField ?? "form_field",
      fact_key: factKey,
      value: { text: value, label, fieldKey: field.fieldKey },
      source: "extension_fill",
      extraction_status: "manual",
      verification_status: "verified",
      excerpt: label.slice(0, 240),
    });
    if (!error) saved += 1;

    if (profileField && profileField !== "date_of_birth") {
      await supabase
        .from("profiles")
        .update({ [profileField]: value })
        .eq("id", userId);
    }
  }
  if (saved > 0) await syncMemoryConflicts(supabase, userId);
  return saved;
}

async function upsertFieldMappings(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
  fillSessionId: string | null,
  fields: FillSessionCapturedField[],
) {
  for (const field of fields) {
    const value = field.value.trim();
    if (!value) continue;

    const { data: existing } = await supabase
      .from("field_mappings")
      .select("id")
      .eq("application_id", applicationId)
      .eq("field_key", field.fieldKey.slice(0, 180))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from("field_mappings")
        .update({
          value: value.slice(0, 4000),
          source: "User (extension fill)",
          confidence: 1,
          excluded_by_default: false,
          label: (field.label || field.fieldKey).slice(0, 180),
          ...(field.fieldType ? { field_type: field.fieldType } : {}),
        })
        .eq("id", existing.id)
        .eq("user_id", userId);
      continue;
    }

    await supabase.from("field_mappings").insert({
      user_id: userId,
      application_id: applicationId,
      fill_session_id: fillSessionId,
      field_key: field.fieldKey.slice(0, 180),
      label: (field.label || field.fieldKey).slice(0, 180),
      value: value.slice(0, 4000),
      source: "User (extension fill)",
      confidence: 1,
      excluded_by_default: false,
      sensitive: false,
      ...(field.fieldType ? { field_type: field.fieldType } : {}),
      options: [],
      meta: {},
    });
  }
}

async function countNeedsYouGaps(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
): Promise<number> {
  const [{ count: reviewCount }, { data: mappings }, { data: application }, { data: answers }] =
    await Promise.all([
      supabase
        .from("review_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("application_id", applicationId)
        .eq("resolved", false),
      supabase
        .from("field_mappings")
        .select("value, confidence, excluded_by_default")
        .eq("user_id", userId)
        .eq("application_id", applicationId),
      supabase
        .from("applications")
        .select("opportunity_id")
        .eq("id", applicationId)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("application_answers")
        .select("question_id, state, approved_text, user_edited_text, missing_facts")
        .eq("user_id", userId)
        .eq("application_id", applicationId),
    ]);

  const mappingGaps = (mappings ?? []).filter(
    (row) =>
      !String(row.value ?? "").trim() ||
      Number(row.confidence ?? 0) < 0.75 ||
      Boolean(row.excluded_by_default),
  ).length;

  let questionGaps = 0;
  if (application?.opportunity_id) {
    const { data: questions } = await supabase
      .from("opportunity_questions")
      .select("id, prompt")
      .eq("opportunity_id", application.opportunity_id)
      .eq("user_id", userId);
    const answerByQ = new Map((answers ?? []).map((row) => [String(row.question_id), row]));
    for (const question of questions ?? []) {
      const prompt = String(question.prompt ?? "");
      if (isStructuredFormFieldPrompt(prompt)) continue;
      const answer = answerByQ.get(String(question.id));
      const text = answer
        ? String(answer.approved_text || answer.user_edited_text || "").trim()
        : "";
      const missing = Array.isArray(answer?.missing_facts)
        ? (answer?.missing_facts as string[]).filter(Boolean)
        : [];
      const approved = Boolean(answer?.approved_text) || String(answer?.state ?? "") === "approved";
      if (!answer || !text || !approved || missing.length > 0) questionGaps += 1;
    }
  }

  return (reviewCount ?? 0) + mappingGaps + questionGaps;
}

export async function markFillStarted(
  supabase: SupabaseClient,
  actor: Actor,
  applicationId: string,
) {
  const { data: application } = await supabase
    .from("applications")
    .select("id, status")
    .eq("id", applicationId)
    .eq("user_id", actor.userId)
    .maybeSingle();
  if (!application) return;
  if (application.status === "submitted") return;

  await supabase
    .from("applications")
    .update({
      status: "in_progress",
      next_action: APPLICATION_LIFECYCLE_ACTIONS.FILLING,
    })
    .eq("id", applicationId)
    .eq("user_id", actor.userId);

  await recordApplicationEvent(supabase, actor, applicationId, "fill.started", {});
  revalidateLifecycle(applicationId);
}

async function continueAfterFillStop(
  supabase: SupabaseClient,
  actor: Actor,
  applicationId: string,
  opportunityId: string,
) {
  try {
    await runOwnedJob(
      supabase,
      { actor, type: "eligibility_evaluate", inputRef: applicationId },
      async () => {
        const { eligibility } = await evaluateApplicationIntelligence(
          supabase,
          actor,
          applicationId,
          opportunityId,
        );

        await supabase
          .from("review_items")
          .delete()
          .eq("application_id", applicationId)
          .eq("resolved", false);

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
            user_id: actor.userId,
            application_id: applicationId,
            kind: "eligibility",
            prompt: item.explanation,
            resolved: false,
          }));
        if (review.length > 0) {
          await supabase.from("review_items").insert(review);
        }

        const { data: questions } = await supabase
          .from("opportunity_questions")
          .select("id, prompt")
          .eq("opportunity_id", opportunityId)
          .eq("required", true)
          .limit(8);

        for (const question of questions ?? []) {
          const prompt = String(question.prompt ?? "");
          if (isStructuredFormFieldPrompt(prompt)) continue;
          try {
            await generateAnswer(supabase, actor, {
              applicationId,
              questionId: String(question.id),
              intent: "draft",
              tone: "formal",
            });
          } catch (err) {
            logError("fill_lifecycle.regenerate_failed", { err, applicationId, questionId: question.id });
          }
        }

        const needsYouCount = await countNeedsYouGaps(supabase, actor.userId, applicationId);
        const hardMiss = eligibility.some((item) => item.hard && item.state === "not_met");
        const nextAction =
          hardMiss || needsYouCount > 0 || review.length > 0
            ? APPLICATION_LIFECYCLE_ACTIONS.NEEDS_YOU
            : APPLICATION_LIFECYCLE_ACTIONS.STOPPED_CONTINUING;

        await supabase
          .from("applications")
          .update({
            status: needsYouCount > 0 || review.length > 0 ? "review_required" : "in_progress",
            next_action: nextAction,
          })
          .eq("id", applicationId);

        await notifyLifecycle(
          supabase,
          actor,
          applicationId,
          needsYouCount > 0 ? "Need You items waiting" : "Application continuing",
          needsYouCount > 0
            ? "Stopped fill session synced. Open Need You for fields Application Memory still lacks."
            : "Stopped fill session synced. Background prep continues from Application Memory.",
          "intelligence.updated",
        );
      },
    );
  } catch (err) {
    logError("fill_lifecycle.continue_failed", { err, applicationId });
  }
}

export async function markSubmittedFromHostSignal(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  signalSnippet: string | null;
  matchedPattern: string | null;
}) {
  const { supabase, actor, applicationId } = input;
  const { data: application } = await supabase
    .from("applications")
    .select("id, status, opportunity_id")
    .eq("id", applicationId)
    .eq("user_id", actor.userId)
    .maybeSingle();

  if (!application) return { submitted: false as const };
  if (application.status === "submitted") {
    return { submitted: true as const, already: true as const };
  }

  const submittedAt = new Date().toISOString();
  await supabase
    .from("applications")
    .update({
      status: "submitted",
      submitted_at: submittedAt,
      next_action: APPLICATION_LIFECYCLE_ACTIONS.SUBMITTED,
    })
    .eq("id", applicationId)
    .eq("user_id", actor.userId);

  await supabase.from("application_status_history").insert({
    user_id: actor.userId,
    application_id: applicationId,
    from_status: application.status,
    to_status: "submitted",
  });

  // Lightweight freeze — host already accepted; full snapshot optional later.
  await supabase.from("submission_snapshots").insert({
    user_id: actor.userId,
    application_id: applicationId,
    submitted_at: submittedAt,
    answer_manifest: [],
    document_manifest: [],
    opportunity_snapshot: {
      detectedVia: "host_signal",
      matchedPattern: input.matchedPattern,
      snippet: input.signalSnippet,
    },
    evidence_manifest: [],
    field_manifest: [],
    application_status: "submitted",
    idempotency_key: `host-signal:${applicationId}:${submittedAt.slice(0, 16)}`,
    guard_result: { mode: "host_signal", ok: true },
  });

  await recordAuditEvent(supabase, "application.submitted_host_signal", {
    applicationId,
    matchedPattern: input.matchedPattern,
  });
  await recordApplicationEvent(supabase, actor, applicationId, "application.submitted", {
    source: "host_signal",
    matchedPattern: input.matchedPattern,
  });
  await notifyLifecycle(
    supabase,
    actor,
    applicationId,
    "Application submitted",
    "Host page signals show this application was already recorded. Tracking it as submitted.",
    "application.status_changed",
  );

  revalidateLifecycle(applicationId);
  return { submitted: true as const, already: false as const };
}

export async function endFillSession(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  reason: FillSessionEndReason;
  origin?: string;
  fillSessionId?: string;
  pageUrl?: string;
  pageText?: string;
  fields: FillSessionCapturedField[];
}) {
  const { supabase, actor, applicationId } = input;

  const { data: application } = await supabase
    .from("applications")
    .select("id, status, opportunity_id")
    .eq("id", applicationId)
    .eq("user_id", actor.userId)
    .maybeSingle();

  if (!application) {
    throw new Error("NOT_FOUND");
  }

  const pageSignal = detectSubmissionSignals(input.pageText);
  const treatAsSubmitted = input.reason === "submitted_detected" || pageSignal.submitted;

  if (treatAsSubmitted) {
    const result = await markSubmittedFromHostSignal({
      supabase,
      actor,
      applicationId,
      signalSnippet: pageSignal.snippet,
      matchedPattern: pageSignal.matchedPattern ?? "submitted_detected",
    });
    return {
      applicationId,
      status: "submitted" as const,
      nextAction: APPLICATION_LIFECYCLE_ACTIONS.SUBMITTED,
      savedFieldCount: 0,
      needsYouCount: 0,
      submitted: true,
      submissionSignal: pageSignal.matchedPattern ?? "submitted_detected",
      alreadySubmitted: Boolean(result.already),
    };
  }

  const savedFieldCount = await storeCapturedFieldsInMemory(supabase, actor.userId, input.fields);
  await upsertFieldMappings(
    supabase,
    actor.userId,
    applicationId,
    input.fillSessionId ?? null,
    input.fields,
  );

  const missingRequired = input.fields.filter((field) => field.required && !field.value.trim()).length;
  const needsYouHint = missingRequired > 0;
  const nextAction = needsYouHint
    ? APPLICATION_LIFECYCLE_ACTIONS.NEEDS_YOU
    : APPLICATION_LIFECYCLE_ACTIONS.STOPPED_CONTINUING;
  const status = needsYouHint ? "review_required" : "in_progress";

  if (application.status !== "submitted") {
    await supabase
      .from("applications")
      .update({ status, next_action: nextAction })
      .eq("id", applicationId)
      .eq("user_id", actor.userId);
  }

  await recordAuditEvent(supabase, "fill.session_ended", {
    applicationId,
    reason: input.reason,
    savedFieldCount,
    fieldCount: input.fields.length,
    origin: input.origin ?? null,
    pageUrl: input.pageUrl ?? null,
  });
  await recordApplicationEvent(supabase, actor, applicationId, "fill.session_ended", {
    reason: input.reason,
    savedFieldCount,
  });

  await notifyLifecycle(
    supabase,
    actor,
    applicationId,
    "Fill session synced",
    savedFieldCount > 0
      ? `Saved ${savedFieldCount} field(s) to Application Memory. Continuing in the background.`
      : "Fill stopped. Continuing from Application Memory in the background.",
    "intelligence.updated",
  );

  if (application.opportunity_id) {
    await continueAfterFillStop(supabase, actor, applicationId, application.opportunity_id);
  }

  // Rematch kit into any remaining gaps before final status / count.
  await refreshOpenApplicationsFromKit(supabase, actor).catch((error) => {
    logError("fill_lifecycle.kit_refresh_after_stop_failed", {
      applicationId,
      message: error instanceof Error ? error.message : "unknown",
    });
  });

  const needsYouCount = await countNeedsYouGaps(supabase, actor.userId, applicationId);
  if (application.status !== "submitted") {
    await supabase
      .from("applications")
      .update({
        status: needsYouCount > 0 ? "review_required" : "in_progress",
        next_action:
          needsYouCount > 0
            ? APPLICATION_LIFECYCLE_ACTIONS.NEEDS_YOU
            : APPLICATION_LIFECYCLE_ACTIONS.STOPPED_CONTINUING,
      })
      .eq("id", applicationId)
      .eq("user_id", actor.userId);
  }

  const { data: refreshed } = await supabase
    .from("applications")
    .select("status, next_action")
    .eq("id", applicationId)
    .maybeSingle();

  revalidateLifecycle(applicationId);

  return {
    applicationId,
    status: (refreshed?.status as string) ?? status,
    nextAction: String(refreshed?.next_action ?? nextAction),
    savedFieldCount,
    needsYouCount,
    submitted: false,
    submissionSignal: null as string | null,
    alreadySubmitted: false,
  };
}

/** Background probe: fetch host page and mark submitted when copy says so. */
export async function probeApplicationSubmission(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  sourceUrl: string | null;
}) {
  if (!input.sourceUrl) return { submitted: false as const };

  const { data: application } = await input.supabase
    .from("applications")
    .select("id, status")
    .eq("id", input.applicationId)
    .eq("user_id", input.actor.userId)
    .maybeSingle();
  if (!application || application.status === "submitted") {
    return { submitted: application?.status === "submitted" };
  }

  try {
    const fetched = await fetchPublicPageText(input.sourceUrl);
    const signal = detectSubmissionSignals(fetched.text);
    if (!signal.submitted) return { submitted: false as const };

    await markSubmittedFromHostSignal({
      supabase: input.supabase,
      actor: input.actor,
      applicationId: input.applicationId,
      signalSnippet: signal.snippet,
      matchedPattern: signal.matchedPattern,
    });
    return { submitted: true as const, matchedPattern: signal.matchedPattern };
  } catch (err) {
    logError("fill_lifecycle.probe_failed", {
      err,
      applicationId: input.applicationId,
    });
    return { submitted: false as const };
  }
}
