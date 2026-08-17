import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";

export async function notifyUser(
  supabase: SupabaseClient,
  actor: Actor,
  input: { applicationId?: string; title: string; body: string },
) {
  await supabase.from("notifications").insert({
    user_id: actor.userId,
    application_id: input.applicationId ?? null,
    title: input.title,
    body: input.body,
  });
}

export async function recordApplicationEvent(
  supabase: SupabaseClient,
  actor: Actor,
  applicationId: string,
  eventName: string,
  payload: Record<string, unknown> = {},
) {
  await supabase.from("application_events").insert({
    user_id: actor.userId,
    application_id: applicationId,
    event_name: eventName,
    payload,
  });
}

export async function listIntegrations(supabase: SupabaseClient, actor: Actor) {
  const { data } = await supabase.from("integrations").select("id, provider, kind, status, account_label").eq("user_id", actor.userId);
  return data ?? [];
}
