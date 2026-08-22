import { computeDeadlineInfo, generateReminder } from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { emitDomainEvent } from "@/server/notifications/service";

const SIX_HOURS = 6 * 60 * 60 * 1000;
const TWENTY_HOURS = 20 * 60 * 60 * 1000;

export async function syncDeadlineReminders(supabase: SupabaseClient, actor: Actor) {
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

  for (const application of applications ?? []) {
    const deadline = computeDeadlineInfo(
      (application.deadline_at as string | null) ?? null,
      (application.deadline_timezone as string | null) || actor.profile.timezone,
      now,
    );
    if (!["imminent", "soon", "overdue", "upcoming"].includes(deadline.urgency)) continue;

    const last = application.last_reminder_at ? new Date(String(application.last_reminder_at)) : null;
    const minInterval = deadline.urgency === "imminent" || deadline.urgency === "overdue" ? SIX_HOURS : TWENTY_HOURS;
    if (last && !Number.isNaN(last.getTime()) && now.getTime() - last.getTime() < minInterval) continue;

    const opportunity = Array.isArray(application.opportunities) ? application.opportunities[0] : application.opportunities;
    const reminder = generateReminder({
      applicationTitle: (opportunity as { title?: string } | null)?.title ?? "Application",
      organization: (opportunity as { organization?: string | null } | null)?.organization ?? null,
      deadlineAt: (application.deadline_at as string | null) ?? null,
      deadlineTimezone: (application.deadline_timezone as string | null) || actor.profile.timezone,
      completenessPercent: 50,
      totalQuestions: 0,
      answeredQuestions: 0,
      pendingDocuments: 0,
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
    }, now);
    if (!reminder) continue;

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
