import {
  buildPreDeadlineReviewNotice,
  computeDeadlineInfo,
  notificationIdempotencyKey,
  packetAnswerText,
  packetSummary,
  shouldSendPreDeadlineReviewNotice,
  type DeadlineInfo,
} from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { sendTransactionalEmail } from "@/infra/email/resend";
import { logInfo } from "@/lib/log";
import { emitDomainEvent } from "@/server/notifications/service";

const PRE_DEADLINE_REVIEW_IDEMPOTENCY = (applicationId: string) =>
  `${applicationId}:pre_deadline_review:email`;

export async function hasPreDeadlineReviewNotice(
  supabase: SupabaseClient,
  applicationId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("reminders")
    .select("id")
    .eq("idempotency_key", PRE_DEADLINE_REVIEW_IDEMPOTENCY(applicationId))
    .maybeSingle();
  return Boolean(data);
}

export async function sendPreDeadlineReviewNoticeIfDue(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  opportunityId: string | null;
  applicationTitle: string;
  organization: string | null;
  deadline: DeadlineInfo;
  packetSummary: string;
  prepareAndSendIfSilent: boolean;
  appBaseUrl: string;
}): Promise<boolean> {
  const {
    supabase,
    actor,
    applicationId,
    opportunityId,
    applicationTitle,
    organization,
    deadline,
    packetSummary,
    prepareAndSendIfSilent,
    appBaseUrl,
  } = input;

  if (!shouldSendPreDeadlineReviewNotice(deadline.hoursRemaining, prepareAndSendIfSilent)) {
    return false;
  }

  const idempotencyKey = PRE_DEADLINE_REVIEW_IDEMPOTENCY(applicationId);
  const { data: existing } = await supabase
    .from("reminders")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing) return true;

  const reviewUrl = `${appBaseUrl.replace(/\/$/, "")}/app/applications/${applicationId}#submission`;
  const notice = buildPreDeadlineReviewNotice({
    applicationTitle,
    organization,
    deadlineLabel: deadline.label,
    packetSummary,
    reviewUrl,
  });

  const { notificationId } = await emitDomainEvent(supabase, {
    name: "application.deadline",
    userId: actor.userId,
    applicationId,
    opportunityId,
    subjectId: `${applicationId}:pre_deadline_review`,
    title: notice.title,
    body: notice.body,
    payload: { preDeadlineReview: true, reviewUrl },
  });

  let emailStatus: "sent" | "logged" | "failed" | "skipped" = "skipped";
  let emailDetail = "Email provider not configured.";
  const emailResult = await sendTransactionalEmail({
    to: actor.profile.email,
    subject: notice.emailSubject,
    html: notice.emailHtml,
    text: notice.body,
  });

  if (emailResult.ok) {
    emailStatus = "sent";
    emailDetail = emailResult.providerId
      ? `Sent via Resend (${emailResult.providerId}).`
      : "Sent via Resend.";
  } else if (emailResult.reason === "email_not_configured") {
    emailStatus = "logged";
    emailDetail = "RESEND_API_KEY not set — email logged for audit only.";
  } else {
    emailStatus = "failed";
    emailDetail = emailResult.reason;
  }

  if (notificationId) {
    await supabase
      .from("notifications")
      .update({ email_status: emailStatus })
      .eq("id", notificationId)
      .eq("user_id", actor.userId);

    await supabase.from("notification_deliveries").insert({
      user_id: actor.userId,
      notification_id: notificationId,
      channel: "email",
      status: emailStatus === "sent" ? "sent" : emailStatus === "failed" ? "failed" : "logged",
      detail: emailDetail,
    });
  }

  await supabase.from("reminders").upsert(
    {
      user_id: actor.userId,
      application_id: applicationId,
      fire_at: deadline.deadlineAt,
      channel: "email",
      status: emailStatus === "sent" ? "sent" : "scheduled",
      idempotency_key: idempotencyKey,
    },
    { onConflict: "idempotency_key" },
  );

  logInfo("deadline.pre_review_notice", {
    applicationId,
    userId: actor.userId,
    emailStatus,
    idempotencyKey: notificationIdempotencyKey(
      actor.userId,
      "deadline_approaching",
      `${applicationId}:pre_deadline_review`,
      new Date().toISOString().slice(0, 10),
    ),
  });

  return true;
}

const APP_BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** Send the review email immediately when a deadline is already inside the 2h→1h window. */
export async function maybeSendPreDeadlineReviewForApplication(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  prepareAndSendIfSilent: boolean;
}): Promise<boolean> {
  if (!input.prepareAndSendIfSilent) return false;

  const { data: application } = await input.supabase
    .from("applications")
    .select(
      "id, opportunity_id, deadline_at, deadline_timezone, opportunities ( title, organization )",
    )
    .eq("id", input.applicationId)
    .eq("user_id", input.actor.userId)
    .maybeSingle();

  if (!application?.deadline_at) return false;

  const opportunity = Array.isArray(application.opportunities)
    ? application.opportunities[0]
    : application.opportunities;
  const deadline = computeDeadlineInfo(
    String(application.deadline_at),
    (application.deadline_timezone as string | null) || input.actor.profile.timezone,
  );

  const [{ data: questions }, { data: answers }, { data: requiredDocs }, { data: attached }] =
    await Promise.all([
      input.supabase.from("opportunity_questions").select("id").eq("opportunity_id", application.opportunity_id),
      input.supabase
        .from("application_answers")
        .select("question_id, approved_text, original_ai_text, user_edited_text")
        .eq("application_id", input.applicationId),
      input.supabase.from("opportunity_documents").select("label, required").eq("opportunity_id", application.opportunity_id),
      input.supabase.from("application_documents").select("document_id").eq("application_id", input.applicationId),
    ]);

  const packetCount = (questions ?? []).filter((question) =>
    (answers ?? []).some(
      (answer) =>
        String(answer.question_id) === String(question.id) &&
        packetAnswerText({
          approvedText: (answer.approved_text as string | null) ?? null,
          userEditedText: (answer.user_edited_text as string | null) ?? null,
          originalAiText: (answer.original_ai_text as string | null) ?? null,
        }),
    ),
  ).length;
  const summary = packetSummary({
    attachedCount: (attached ?? []).length,
    requiredCount: (requiredDocs ?? []).filter((row) => row.required).length,
    questionCount: (questions ?? []).length,
    packetAnswerCount: packetCount,
    suggestionCount: 0,
  });

  return sendPreDeadlineReviewNoticeIfDue({
    supabase: input.supabase,
    actor: input.actor,
    applicationId: input.applicationId,
    opportunityId: (application.opportunity_id as string | null) ?? null,
    applicationTitle: (opportunity as { title?: string } | null)?.title ?? "Application",
    organization: (opportunity as { organization?: string | null } | null)?.organization ?? null,
    deadline,
    packetSummary: summary,
    prepareAndSendIfSilent: input.prepareAndSendIfSilent,
    appBaseUrl: APP_BASE_URL,
  });
}
