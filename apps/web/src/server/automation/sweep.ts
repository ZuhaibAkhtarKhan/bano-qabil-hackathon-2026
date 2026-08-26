import { planAutomation, requiredDocumentCovered, type ApplicationAutomationSnapshot } from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { computeApplicationCompleteness } from "@/lib/application-workflow";
import { emitDomainEvent } from "@/server/notifications/service";
import { runOwnedJob } from "@/infra/jobs/runner";
import { syncDeadlineReminders } from "@/server/applications/reminders";

async function loadSnapshots(supabase: SupabaseClient, actor: Actor): Promise<ApplicationAutomationSnapshot[]> {
  const [{ data: applications }, { data: integrations }, { data: documents }] = await Promise.all([
    supabase
      .from("applications")
      .select("id, opportunity_id, status, deadline_at, deadline_timezone, last_reminder_at, opportunities ( title, organization )")
      .eq("user_id", actor.userId)
      .order("updated_at", { ascending: false })
      .limit(40),
    supabase.from("integrations").select("kind, status").eq("user_id", actor.userId),
    supabase.from("documents").select("id, type, label").eq("user_id", actor.userId),
  ]);

  const gmailConnected = (integrations ?? []).some((row) => row.kind === "gmail" && row.status === "connected");
  const calendarConnected = (integrations ?? []).some((row) => row.kind === "google_calendar" && row.status === "connected");
  const snapshots: ApplicationAutomationSnapshot[] = [];

  for (const application of applications ?? []) {
    const opportunity = Array.isArray(application.opportunities) ? application.opportunities[0] : application.opportunities;
    const [
      { data: questions },
      { data: answers },
      { data: attached },
      { data: requiredDocs },
      { data: fit },
      { data: review },
      { data: calendar },
    ] = await Promise.all([
      supabase.from("opportunity_questions").select("id").eq("opportunity_id", application.opportunity_id),
      supabase.from("application_answers").select("id, state, approved_text").eq("application_id", application.id),
      supabase.from("application_documents").select("id, document_id").eq("application_id", application.id),
      supabase.from("opportunity_documents").select("label, required").eq("opportunity_id", application.opportunity_id),
      supabase.from("fit_evaluations").select("score").eq("application_id", application.id).maybeSingle(),
      supabase.from("review_items").select("id, resolved").eq("application_id", application.id),
      supabase
        .from("calendar_events")
        .select("starts_at, confirmed")
        .eq("application_id", application.id)
        .order("starts_at", { ascending: true })
        .limit(1),
    ]);

    const required = (requiredDocs ?? []).filter((row) => row.required);
    const attachedIds = new Set((attached ?? []).map((row) => String(row.document_id)));
    const attachedVault = (documents ?? [])
      .filter((row) => attachedIds.has(String(row.id)))
      .map((row) => ({ type: String(row.type), label: String(row.label) }));
    const missingDocs = required.filter((row) => !requiredDocumentCovered(String(row.label), attachedVault));
    const approved = (answers ?? []).filter((row) => row.state === "approved" || Boolean(row.approved_text));
    const completeness = computeApplicationCompleteness({
      requiredQuestions: (questions ?? []).length,
      approvedAnswers: approved.length,
      requiredDocuments: required.map((row) => String(row.label)),
      attachedDocumentLabels: required
        .filter((row) => requiredDocumentCovered(String(row.label), attachedVault))
        .map((row) => String(row.label)),
      eligibilityNeedsReview: [],
      missingFitItems: [],
      recommendedResumeSelected: true,
      fieldMappingsPending: 0,
    });

    snapshots.push({
      applicationId: application.id as string,
      opportunityId: (application.opportunity_id as string | null) ?? null,
      userId: actor.userId,
      title: (opportunity as { title?: string } | null)?.title ?? "Application",
      organization: (opportunity as { organization?: string | null } | null)?.organization ?? null,
      status: application.status as string,
      deadlineAt: (application.deadline_at as string | null) ?? null,
      deadlineTimezone: (application.deadline_timezone as string | null) ?? null,
      completenessPercent: completeness.percent,
      totalQuestions: (questions ?? []).length,
      approvedAnswers: approved.length,
      pendingDocuments: missingDocs.length,
      fitScore: (fit?.score as number | null) ?? null,
      unresolvedReviewCount: (review ?? []).filter((row) => !row.resolved).length,
      hasCaptcha: false,
      hasSignature: false,
      hasPayment: false,
      interviewStartsAt: (calendar?.[0]?.starts_at as string | null) ?? null,
      gmailConnected,
      calendarConnected,
      followUps: [],
      lastReminderAt: (application.last_reminder_at as string | null) ?? null,
    });
  }

  return snapshots;
}

export async function runUserAutomationSweep(supabase: SupabaseClient, actor: Actor) {
  const run = async () => {
    const snapshots = await loadSnapshots(supabase, actor);
    const correlationId = crypto.randomUUID();

    for (const snapshot of snapshots) {
      const decisions = planAutomation(snapshot);
      for (const decision of decisions) {
        await supabase.from("automation_runs").insert({
          user_id: actor.userId,
          application_id: snapshot.applicationId,
          kind: decision.kind,
          action: decision.action,
          safe: decision.safe,
          reason: decision.reason,
          correlation_id: correlationId,
          event_name: decision.event?.name ?? null,
        });
        if (decision.action === "notify" && decision.event) {
          await emitDomainEvent(supabase, decision.event);
          await supabase
            .from("applications")
            .update({ last_reminder_at: new Date().toISOString(), next_action: decision.reason.slice(0, 180) })
            .eq("id", snapshot.applicationId)
            .eq("user_id", actor.userId);
        }
      }
    }
    await syncDeadlineReminders(supabase, actor);
  };

  try {
    await runOwnedJob(supabase, { actor, type: "deadline_monitor", inputRef: actor.userId }, run);
  } catch {
    await run();
  }
}
