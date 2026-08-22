import { notificationDraftFromEvent, type DomainEvent } from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAuditEvent } from "@/server/audit";
import { logInfo } from "@/lib/log";

export async function emitDomainEvent(
  supabase: SupabaseClient,
  event: DomainEvent,
  options: { recordTimeline?: boolean } = {},
) {
  await recordAuditEvent(supabase, event.name, {
    applicationId: event.applicationId ?? null,
    opportunityId: event.opportunityId ?? null,
    subjectId: event.subjectId ?? null,
  });

  if (options.recordTimeline !== false && event.applicationId) {
    await supabase.from("application_events").insert({
      user_id: event.userId,
      application_id: event.applicationId,
      event_name: event.name,
      payload: {
        opportunityId: event.opportunityId ?? null,
        subjectId: event.subjectId,
        ...(event.payload ?? {}),
      },
    });
  }

  const draft = notificationDraftFromEvent(event);
  if (!draft) return { notificationId: null as string | null };

  const { data: existing } = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", event.userId)
    .eq("idempotency_key", draft.idempotencyKey)
    .maybeSingle();

  if (existing) {
    return { notificationId: existing.id as string };
  }

  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_id: event.userId,
      application_id: draft.applicationId,
      opportunity_id: draft.opportunityId,
      title: draft.title,
      body: draft.body,
      category: draft.category,
      priority: draft.numericPriority,
      actionable: true,
      notification_state: draft.category,
      action_url: draft.actionUrl,
      event_name: draft.eventName,
      channel: "in_app",
      email_status: draft.channels.includes("email") ? "logged" : null,
      idempotency_key: draft.idempotencyKey,
    })
    .select("id")
    .single();

  if (error || !data) {
    logInfo("notifications.insert_skipped", { code: error?.code, event: event.name });
    return { notificationId: null as string | null };
  }

  await supabase.from("notification_deliveries").insert({
    user_id: event.userId,
    notification_id: data.id,
    channel: "in_app",
    status: "sent",
    detail: "Written to the in-app inbox.",
  });

  if (draft.channels.includes("email")) {
    await supabase.from("notification_deliveries").insert({
      user_id: event.userId,
      notification_id: data.id,
      channel: "email",
      status: "logged",
      detail:
        "Email channel recorded for audit. No host mail was sent; configure a mail provider later without changing callers.",
    });
  }

  return { notificationId: data.id as string };
}

export async function markNotificationRead(supabase: SupabaseClient, userId: string, notificationId: string) {
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId)
    .is("read_at", null);
}

export async function markAllNotificationsRead(supabase: SupabaseClient, userId: string) {
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
}
