/**
 * Google Calendar write service.
 * Events are never created without user confirmation.
 * Requires explicit user approval of proposed calendar events stored in calendar_events table.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { OAuthTokenError, refreshAccessToken } from "./google-oauth";
import { encryptSecret } from "./token-crypto";
import { emitDomainEvent } from "@/server/notifications/service";

const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

type CalendarEventBody = {
  summary: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  location?: string;
  description?: string;
  conferenceData?: unknown;
};

async function calendarFetch<T>(
  accessToken: string,
  url: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
): Promise<T> {
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const errBody = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    throw new OAuthTokenError(
      `Calendar API error: ${resp.status} ${JSON.stringify(errBody)}`,
      String((errBody.error as { status?: string } | null)?.status ?? resp.status),
    );
  }
  return method === "DELETE" ? ({} as T) : (resp.json() as Promise<T>);
}

export type CalendarWriteResult = {
  externalId: string;
  htmlLink: string;
};

export async function confirmAndCreateCalendarEvent(input: {
  supabase: SupabaseClient;
  userId: string;
  integrationId: string;
  calendarEventId: string;
  accessToken: string;
  refreshToken: string | null;
}): Promise<CalendarWriteResult> {
  const { supabase, userId, integrationId, calendarEventId } = input;

  const { data: event } = await supabase
    .from("calendar_events")
    .select("*")
    .eq("id", calendarEventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!event) throw new Error("Calendar event not found.");
  if (event.confirmed) throw new Error("Event already confirmed and created.");
  if (event.external_id) throw new Error("Event already has an external ID — duplicate prevented.");

  let accessToken = input.accessToken;

  const body: CalendarEventBody = {
    summary: event.title,
    start: {
      dateTime: event.starts_at,
      ...(event.timezone ? { timeZone: event.timezone } : {}),
    },
    end: {
      dateTime: event.ends_at ?? new Date(new Date(event.starts_at).getTime() + 60 * 60 * 1000).toISOString(),
      ...(event.timezone ? { timeZone: event.timezone } : {}),
    },
    ...(event.location ? { location: event.location } : {}),
    ...(event.notes ? { description: event.notes } : {}),
  };

  let created: { id: string; htmlLink: string };
  try {
    created = await calendarFetch<typeof created>(accessToken, CALENDAR_EVENTS_URL, "POST", body);
  } catch (err) {
    if (err instanceof OAuthTokenError && input.refreshToken) {
      try {
        const refreshed = await refreshAccessToken(input.refreshToken);
        accessToken = refreshed.accessToken;
        await supabase
          .from("integration_tokens")
          .update({
            access_token: encryptSecret(accessToken),
            expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
          })
          .eq("integration_id", integrationId);
        created = await calendarFetch<typeof created>(accessToken, CALENDAR_EVENTS_URL, "POST", body);
      } catch (refreshErr) {
        if (refreshErr instanceof OAuthTokenError && refreshErr.code === "REVOKED") {
          await supabase.from("integrations").update({ status: "revoked" }).eq("id", integrationId);
        }
        throw refreshErr;
      }
    } else throw err;
  }

  await supabase
    .from("calendar_events")
    .update({ confirmed: true, external_id: created.id })
    .eq("id", calendarEventId);

  await emitDomainEvent(supabase, {
    name: "calendar.confirmed",
    userId,
    applicationId: event.application_id as string | null,
    subjectId: calendarEventId,
    title: "Calendar event created",
    body: `"${event.title}" has been added to your Google Calendar.`,
  });

  return { externalId: created.id, htmlLink: created.htmlLink };
}

export async function deleteCalendarEvent(input: {
  supabase: SupabaseClient;
  userId: string;
  integrationId: string;
  calendarEventId: string;
  accessToken: string;
  refreshToken: string | null;
}): Promise<void> {
  const { supabase, userId, calendarEventId } = input;
  const { data: event } = await supabase
    .from("calendar_events")
    .select("id, external_id, user_id")
    .eq("id", calendarEventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!event) throw new Error("Calendar event not found.");

  if (event.external_id) {
    try {
      await calendarFetch(
        input.accessToken,
        `${CALENDAR_EVENTS_URL}/${encodeURIComponent(event.external_id)}`,
        "DELETE",
      );
    } catch { /* best-effort remote delete */ }
  }

  await supabase.from("calendar_events").delete().eq("id", calendarEventId).eq("user_id", userId);
}

export async function importUpcomingCalendarEvents(input: {
  supabase: SupabaseClient;
  userId: string;
  integrationId: string;
  accessToken: string;
  refreshToken: string | null;
}): Promise<{ imported: number }> {
  const { supabase, userId, integrationId } = input;
  let accessToken = input.accessToken;
  const timeMin = new Date().toISOString();
  const listUrl = `${CALENDAR_EVENTS_URL}?timeMin=${encodeURIComponent(timeMin)}&maxResults=25&singleEvents=true&orderBy=startTime`;

  type GoogleEvent = {
    id?: string;
    summary?: string;
    start?: { dateTime?: string; date?: string; timeZone?: string };
    end?: { dateTime?: string; date?: string };
    location?: string;
    hangoutLink?: string;
    htmlLink?: string;
    description?: string;
  };

  let payload: { items?: GoogleEvent[] };
  try {
    payload = await calendarFetch<typeof payload>(accessToken, listUrl, "GET");
  } catch (err) {
    if (err instanceof OAuthTokenError && input.refreshToken) {
      const refreshed = await refreshAccessToken(input.refreshToken);
      accessToken = refreshed.accessToken;
      await supabase
        .from("integration_tokens")
        .update({
          access_token: encryptSecret(accessToken),
          expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
        })
        .eq("integration_id", integrationId);
      payload = await calendarFetch<typeof payload>(accessToken, listUrl, "GET");
    } else {
      throw err;
    }
  }

  let imported = 0;
  for (const item of payload.items ?? []) {
    const externalId = item.id;
    const startsAt = item.start?.dateTime || (item.start?.date ? `${item.start.date}T09:00:00.000Z` : null);
    if (!externalId || !startsAt) continue;

    const { data: existing } = await supabase
      .from("calendar_events")
      .select("id")
      .eq("user_id", userId)
      .eq("external_id", externalId)
      .maybeSingle();
    if (existing) continue;

    const { error } = await supabase.from("calendar_events").insert({
      user_id: userId,
      integration_id: integrationId,
      application_id: null,
      starts_at: startsAt,
      ends_at: item.end?.dateTime ?? item.end?.date ?? null,
      title: (item.summary ?? "Calendar event").slice(0, 180),
      external_id: externalId,
      location: item.location ?? null,
      meeting_url: item.hangoutLink ?? item.htmlLink ?? null,
      timezone: item.start?.timeZone ?? null,
      confirmed: true,
      notes: item.description?.slice(0, 500) ?? "Imported from Google Calendar.",
    });
    if (!error) imported += 1;
  }

  if (imported > 0) {
    await emitDomainEvent(supabase, {
      name: "calendar.confirmed",
      userId,
      subjectId: integrationId,
      title: "Google Calendar imported",
      body: `Imported ${imported} upcoming event${imported === 1 ? "" : "s"} from Google Calendar.`,
    });
  }

  return { imported };
}
