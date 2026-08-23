"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireWorkspace } from "@/server/auth/require-workspace";
import { buildAuthorizationUrl, oauthRedirectUri, revokeToken, OAuthConfigError } from "@/server/integrations/google-oauth";
import { createOAuthState, storeOAuthState } from "@/server/integrations/oauth-state";
import { unwrapTokenRow } from "@/server/integrations/token-crypto";
import { syncGmailMessages } from "@/server/integrations/gmail-sync";
import { confirmAndCreateCalendarEvent, deleteCalendarEvent } from "@/server/integrations/calendar-sync";
import { emitDomainEvent } from "@/server/notifications/service";
import { runPostConnectSync } from "@/server/integrations/post-connect";

function integrationPath() {
  return "/app/integrations";
}

async function startOAuth(kind: "gmail" | "google_calendar", userId: string) {
  const payload = createOAuthState(kind, userId);
  await storeOAuthState(payload);
  return buildAuthorizationUrl({ kind, state: payload.token, redirectUri: oauthRedirectUri(kind) });
}

export async function connectGmail() {
  const { user } = await requireWorkspace();
  try {
    redirect(await startOAuth("gmail", user.id));
  } catch (err) {
    if (err instanceof OAuthConfigError) {
      redirect(`${integrationPath()}?error=oauth_not_configured`);
    }
    throw err;
  }
}

export async function connectCalendar() {
  const { user } = await requireWorkspace();
  try {
    redirect(await startOAuth("google_calendar", user.id));
  } catch (err) {
    if (err instanceof OAuthConfigError) {
      redirect(`${integrationPath()}?error=oauth_not_configured`);
    }
    throw err;
  }
}

// ── Disconnect / revoke ───────────────────────────────────────────────────────

export async function disconnectIntegration(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const integrationId = String(formData.get("integrationId") ?? "");

  const { data: integration } = await supabase
    .from("integrations")
    .select("id, status")
    .eq("id", integrationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!integration) {
    redirect(`${integrationPath()}?error=not_found`);
  }

  // Revoke token if we stored one
  const { data: token } = await supabase
    .from("integration_tokens")
    .select("access_token, refresh_token")
    .eq("integration_id", integrationId)
    .maybeSingle();

  if (token?.access_token) {
    const secrets = unwrapTokenRow(token);
    await revokeToken(secrets.accessToken).catch(() => {
      /* best-effort */
    });
    if (secrets.refreshToken) {
      await revokeToken(secrets.refreshToken).catch(() => {
        /* best-effort */
      });
    }
  }

  await supabase.from("integration_tokens").delete().eq("integration_id", integrationId);
  await supabase.from("integrations").update({ status: "revoked" }).eq("id", integrationId);

  await emitDomainEvent(supabase, {
    name: "integration.disconnected",
    userId: user.id,
    subjectId: integrationId,
    title: "Integration disconnected",
    body: "Access token revoked. Sync will not run. Reconnect from Integrations.",
  });

  revalidatePath(integrationPath());
  redirect(integrationPath());
}

// ── Trigger Gmail sync ────────────────────────────────────────────────────────

export async function triggerGmailSync(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const integrationId = String(formData.get("integrationId") ?? "");

  const { data: integration } = await supabase
    .from("integrations")
    .select("id, status, kind")
    .eq("id", integrationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!integration || integration.kind !== "gmail" || integration.status !== "connected") {
    redirect(`${integrationPath()}?error=not_connected`);
  }

  const { data: token } = await supabase
    .from("integration_tokens")
    .select("access_token, refresh_token")
    .eq("integration_id", integrationId)
    .maybeSingle();

  if (!token?.access_token) {
    redirect(`${integrationPath()}?error=no_token`);
  }

  const { data: applications } = await supabase
    .from("applications")
    .select("id, opportunity_id, opportunities ( title, organization, source_url )")
    .eq("user_id", user.id);

  const candidates = (applications ?? []).map((app) => {
    const opp = Array.isArray(app.opportunities) ? app.opportunities[0] : app.opportunities;
    return {
      id: app.id as string,
      opportunityTitle: (opp as { title?: string } | null)?.title ?? "",
      organization: (opp as { organization?: string | null } | null)?.organization ?? null,
      sourceUrl: (opp as { source_url?: string | null } | null)?.source_url ?? null,
      status: "",
    };
  });

  const secrets = unwrapTokenRow(token);
  const result = await syncGmailMessages({
    supabase,
    userId: user.id,
    integrationId,
    accessToken: secrets.accessToken,
    refreshToken: secrets.refreshToken,
    applications: candidates,
  });

  await emitDomainEvent(supabase, {
    name: "email.synced",
    userId: user.id,
    subjectId: integrationId,
    title: "Gmail sync complete",
    body: `Processed ${result.processed} emails · ${result.classified} relevant · ${result.associated} associated · ${result.interviewsDetected} interview(s) detected.${result.errors.length ? ` ${result.errors.length} error(s).` : ""}`,
  });

  revalidatePath(integrationPath());
  redirect(integrationPath());
}

export async function triggerCalendarSync(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const integrationId = String(formData.get("integrationId") ?? "");

  const { data: integration } = await supabase
    .from("integrations")
    .select("id, status, kind")
    .eq("id", integrationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!integration || integration.kind !== "google_calendar" || integration.status !== "connected") {
    redirect(`${integrationPath()}?error=not_connected`);
  }

  const { data: token } = await supabase
    .from("integration_tokens")
    .select("access_token, refresh_token")
    .eq("integration_id", integrationId)
    .maybeSingle();

  if (!token?.access_token) {
    redirect(`${integrationPath()}?error=no_token`);
  }

  await runPostConnectSync({
    supabase,
    userId: user.id,
    kind: "google_calendar",
    integrationId,
  });

  revalidatePath(integrationPath());
  redirect(integrationPath());
}

// ── Confirm calendar event ────────────────────────────────────────────────────

export async function confirmCalendarEvent(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const calendarEventId = String(formData.get("calendarEventId") ?? "");

  const { data: event } = await supabase
    .from("calendar_events")
    .select("integration_id")
    .eq("id", calendarEventId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!event) redirect(`${integrationPath()}?error=not_found`);

  const integrationId = event.integration_id as string;
  const { data: token } = await supabase
    .from("integration_tokens")
    .select("access_token, refresh_token")
    .eq("integration_id", integrationId)
    .maybeSingle();

  if (!token?.access_token) redirect(`${integrationPath()}?error=no_token`);

  const secrets = unwrapTokenRow(token);
  await confirmAndCreateCalendarEvent({
    supabase,
    userId: user.id,
    integrationId,
    calendarEventId,
    accessToken: secrets.accessToken,
    refreshToken: secrets.refreshToken,
  });

  revalidatePath(integrationPath());
  redirect(integrationPath());
}

export async function dismissCalendarEvent(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const calendarEventId = String(formData.get("calendarEventId") ?? "");

  const { data: event } = await supabase
    .from("calendar_events")
    .select("integration_id, external_id")
    .eq("id", calendarEventId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!event) redirect(`${integrationPath()}?error=not_found`);

  if (event.external_id) {
    const { data: token } = await supabase
      .from("integration_tokens")
      .select("access_token, refresh_token")
      .eq("integration_id", event.integration_id)
      .maybeSingle();

    if (token?.access_token) {
      const secrets = unwrapTokenRow(token);
      await deleteCalendarEvent({
        supabase,
        userId: user.id,
        integrationId: event.integration_id as string,
        calendarEventId,
        accessToken: secrets.accessToken,
        refreshToken: secrets.refreshToken,
      });
      revalidatePath(integrationPath());
      redirect(integrationPath());
    }
  }

  await supabase.from("calendar_events").delete().eq("id", calendarEventId).eq("user_id", user.id);
  revalidatePath(integrationPath());
  redirect(integrationPath());
}

// ── Correct email association ─────────────────────────────────────────────────

export async function correctEmailAssociation(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const emailEventId = String(formData.get("emailEventId") ?? "");
  const applicationId = String(formData.get("applicationId") ?? "").trim() || null;

  await supabase
    .from("email_events")
    .update({ application_id: applicationId, user_corrected: true })
    .eq("id", emailEventId)
    .eq("user_id", user.id);

  revalidatePath(integrationPath());
  redirect(integrationPath());
}
