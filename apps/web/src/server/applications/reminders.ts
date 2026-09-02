import {
  SILENCE_AUTO_SUBMIT_POLICY,
  computeDeadlineInfo,
  evaluateAutoSubmit,
  generateReminder,
  packetAnswerText,
  packetSummary,
  requiredDocumentCovered,
} from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { freezeApplicationPacket } from "@/server/applications/freeze-packet";
import { autoFillNeedsYouTextBeforeDeadline } from "@/server/needs-you/auto-fill-deadline";
import { emitDomainEvent } from "@/server/notifications/service";
import { parseWorkspacePreferences } from "@/lib/workspace-preferences";

const SIX_HOURS = 6 * 60 * 60 * 1000;
const TWENTY_HOURS = 20 * 60 * 60 * 1000;

export async function syncDeadlineReminders(supabase: SupabaseClient, actor: Actor) {
  const prefs = parseWorkspacePreferences(actor.profile.preferences);
  const { data: applications } = await supabase
    .from("applications")
    .select(
      "id, opportunity_id, status, deadline_at, deadline_timezone, last_reminder_at, opportunities ( title, organization )",
    )
    .eq("user_id", actor.userId)
    .not("deadline_at", "is", null)
    .order("deadline_at", { ascending: true })
    .limit(40);

  const now = new Date();
  const identityPresent = Boolean(actor.profile.display_name?.trim());
  const needsYouQueue =
    prefs.prepareAndSendIfSilent || applications?.some((row) => {
      const deadline = computeDeadlineInfo(
        (row.deadline_at as string | null) ?? null,
        (row.deadline_timezone as string | null) || actor.profile.timezone,
        now,
      );
      return ["imminent", "soon", "overdue"].includes(deadline.urgency);
    })
      ? await (async () => {
          const { loadNeedsYouQueue } = await import("@/server/needs-you/queries");
          return loadNeedsYouQueue({ polish: false });
        })()
      : null;
  const needsYouItemsByApp = new Map<string, NonNullable<typeof needsYouQueue>["items"]>();
  if (needsYouQueue) {
    for (const item of needsYouQueue.items) {
      const list = needsYouItemsByApp.get(item.applicationId) ?? [];
      list.push(item);
      needsYouItemsByApp.set(item.applicationId, list);
    }
  }

  for (const application of applications ?? []) {
    const deadline = computeDeadlineInfo(
      (application.deadline_at as string | null) ?? null,
      (application.deadline_timezone as string | null) || actor.profile.timezone,
      now,
    );
    if (!["imminent", "soon", "overdue", "upcoming"].includes(deadline.urgency)) continue;

    const opportunity = Array.isArray(application.opportunities) ? application.opportunities[0] : application.opportunities;
    const [
      { data: questions },
      { data: answers },
      { data: requiredDocs },
      { data: attached },
      { data: attachedDocs },
    ] = await Promise.all([
      supabase.from("opportunity_questions").select("id").eq("opportunity_id", application.opportunity_id),
      supabase
        .from("application_answers")
        .select("question_id, state, approved_text, original_ai_text, user_edited_text")
        .eq("application_id", application.id),
      supabase.from("opportunity_documents").select("label, required").eq("opportunity_id", application.opportunity_id),
      supabase.from("application_documents").select("document_id").eq("application_id", application.id),
      supabase.from("documents").select("id, type, label").eq("user_id", actor.userId),
    ]);

    const attachedIds = new Set((attached ?? []).map((row) => String(row.document_id)));
    const attachedVault = (attachedDocs ?? [])
      .filter((row) => attachedIds.has(String(row.id)))
      .map((row) => ({ type: String(row.type), label: String(row.label) }));
    const required = (requiredDocs ?? []).filter((row) => row.required);
    const missingDocs = required
      .filter((row) => !requiredDocumentCovered(String(row.label), attachedVault))
      .map((row) => String(row.label));
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
    const suggestionCount = (answers ?? []).filter((row) => row.state === "ai_generated" || row.state === "user_edited").length;
    const summary = packetSummary({
      attachedCount: attachedIds.size,
      requiredCount: required.length,
      questionCount: (questions ?? []).length,
      packetAnswerCount: packetCount,
      suggestionCount,
    });

    const last = application.last_reminder_at ? new Date(String(application.last_reminder_at)) : null;
    const minInterval = deadline.urgency === "imminent" || deadline.urgency === "overdue" ? SIX_HOURS : TWENTY_HOURS;
    const dueForNotice = !(last && !Number.isNaN(last.getTime()) && now.getTime() - last.getTime() < minInterval);

    if (dueForNotice) {
      const reminder = generateReminder(
        {
          applicationTitle: (opportunity as { title?: string } | null)?.title ?? "Application",
          organization: (opportunity as { organization?: string | null } | null)?.organization ?? null,
          deadlineAt: (application.deadline_at as string | null) ?? null,
          deadlineTimezone: (application.deadline_timezone as string | null) || actor.profile.timezone,
          completenessPercent: (questions ?? []).length === 0 ? 80 : Math.round((packetCount / (questions ?? []).length) * 100),
          totalQuestions: (questions ?? []).length,
          answeredQuestions: packetCount,
          pendingDocuments: missingDocs.length,
          fitScore: null,
          status: application.status as string,
          submittedAt: null,
          hasCaptcha: false,
          hasSignature: false,
          hasPayment: false,
          unresolvedReviewCount: 0,
          interviewDates: [],
          contacts: [],
          followUps: [],
          prepareAndSendIfSilent: prefs.prepareAndSendIfSilent,
          packetSummary: summary,
          identityPresent,
        },
        now,
      );

      if (reminder) {
        const dayKey = now.toISOString().slice(0, 10);
        const idempotencyKey = `${application.id}:deadline:${deadline.urgency}:${dayKey}`;
        await supabase.from("reminders").upsert(
          {
            user_id: actor.userId,
            application_id: application.id,
            fire_at: application.deadline_at,
            channel: "in_app",
            status: "sent",
            idempotency_key: idempotencyKey,
          },
          { onConflict: "idempotency_key" },
        );
        await emitDomainEvent(supabase, {
          name: "application.deadline",
          userId: actor.userId,
          applicationId: application.id as string,
          opportunityId: (application.opportunity_id as string | null) ?? null,
          subjectId: `${application.id}:deadline_monitor`,
          title: reminder.title,
          body: reminder.body,
        });
        await supabase
          .from("applications")
          .update({ last_reminder_at: now.toISOString(), next_action: reminder.body.slice(0, 180) })
          .eq("id", application.id)
          .eq("user_id", actor.userId);
      }
    }

    const deadlineUrgent = ["imminent", "soon", "overdue"].includes(deadline.urgency);
    if (deadlineUrgent) {
      try {
        await autoFillNeedsYouTextBeforeDeadline(
          supabase,
          actor,
          application.id as string,
          (application.deadline_at as string | null) ?? null,
          (application.deadline_timezone as string | null) || actor.profile.timezone,
          needsYouItemsByApp.get(application.id as string),
        );
      } catch {
        // Non-fatal — silence-send may still proceed with existing drafts.
      }
    }

    if (!prefs.prepareAndSendIfSilent) continue;

    const [
      { data: answersAfterFill },
      { data: attachedAfterFill },
    ] = deadlineUrgent
      ? await Promise.all([
          supabase
            .from("application_answers")
            .select("question_id, state, approved_text, original_ai_text, user_edited_text")
            .eq("application_id", application.id),
          supabase.from("application_documents").select("document_id").eq("application_id", application.id),
        ])
      : [{ data: answers }, { data: attached }];

    const answersForSubmit = answersAfterFill ?? answers ?? [];
    const attachedForSubmit = attachedAfterFill ?? attached ?? [];
    const attachedIdsForSubmit = new Set((attachedForSubmit ?? []).map((row) => String(row.document_id)));
    const attachedVaultForSubmit = (attachedDocs ?? [])
      .filter((row) => attachedIdsForSubmit.has(String(row.id)))
      .map((row) => ({ type: String(row.type), label: String(row.label) }));
    const missingDocsForSubmit = required
      .filter((row) => !requiredDocumentCovered(String(row.label), attachedVaultForSubmit))
      .map((row) => String(row.label));
    const packetCountForSubmit = (questions ?? []).filter((question) =>
      (answersForSubmit ?? []).some(
        (answer) =>
          String(answer.question_id) === String(question.id) &&
          packetAnswerText({
            approvedText: (answer.approved_text as string | null) ?? null,
            userEditedText: (answer.user_edited_text as string | null) ?? null,
            originalAiText: (answer.original_ai_text as string | null) ?? null,
          }),
      ),
    ).length;

    const decision = evaluateAutoSubmit(
      SILENCE_AUTO_SUBMIT_POLICY,
      {
        applicationTitle: (opportunity as { title?: string } | null)?.title ?? "Application",
        organization: (opportunity as { organization?: string | null } | null)?.organization ?? null,
        deadlineAt: (application.deadline_at as string | null) ?? null,
        deadlineTimezone: (application.deadline_timezone as string | null) || actor.profile.timezone,
        completenessPercent: 80,
        totalQuestions: (questions ?? []).length,
        answeredQuestions: packetCountForSubmit,
        pendingDocuments: missingDocsForSubmit.length,
        fitScore: null,
        status: application.status as string,
        submittedAt: null,
        hasCaptcha: false,
        hasSignature: false,
        hasPayment: false,
        unresolvedReviewCount: 0,
        interviewDates: [],
        contacts: [],
        followUps: [],
        identityPresent,
        packetNoticeSent: Boolean(application.last_reminder_at) || dueForNotice,
        allQuestionsHavePacketText:
          (questions ?? []).length === 0 || packetCountForSubmit === (questions ?? []).length,
        allAnswersApproved:
          (answersForSubmit ?? []).every((row) => row.state === "approved") &&
          (questions ?? []).length === packetCountForSubmit,
        documentsAttached: missingDocsForSubmit.length === 0,
        hasUnsupportedClaims: false,
      },
      now,
    );

    if (decision.action === "proceed") {
      await freezeApplicationPacket({
        supabase,
        actor,
        applicationId: application.id as string,
        source: "silence",
      });
    } else if (decision.action === "pause") {
      await emitDomainEvent(supabase, {
        name: "automation.account_action",
        userId: actor.userId,
        applicationId: application.id as string,
        subjectId: `${application.id}:host_action`,
        title: "Waiting on you at the host",
        body: `${decision.reason} ${decision.humanActionRequired.join(" ")}`,
        payload: { captcha: true },
      });
    }
  }
}
