"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireWorkspace } from "@/server/auth/require-workspace";
import { loadAppConfig } from "@/config/env";
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  revokeToken,
  OAuthConfigError,
  type OAuthKind,
} from "@/server/integrations/google-oauth";
import { syncGmailMessages } from "@/server/integrations/gmail-sync";
import { confirmAndCreateCalendarEvent, deleteCalendarEvent } from "@/server/integrations/calendar-sync";

function integrationPath() {
  return "/app/integrations";
}

function appUrl(): string {
  return loadAppConfig().appUrl.replace(/\/$/, "");
}

function redirectUri(kind: OAuthKind): string {
  return `${appUrl()}/api/integrations/callback?kind=${kind}`;
}

// ── Connect Gmail ─────────────────────────────────────────────────────────────

export async function connectGmail() {
  const { user } = await requireWorkspace();
  try {
    const state = encodeURIComponent(JSON.stringify({ userId: user.id, kind: "gmail", nonce: crypto.randomUUID() }));
    const url = buildAuthorizationUrl({ kind: "gmail", state, redirectUri: redirectUri("gmail") });
    redirect(url);
  } catch (err) {
    if (err instanceof OAuthConfigError) {
      redirect(`${integrationPath()}?error=oauth_not_configured`);
    }
    throw err;
  }
}

// ── Connect Calendar ──────────────────────────────────────────────────────────

export async function connectCalendar() {
  const { user } = await requireWorkspace();
  try {
    const state = encodeURIComponent(
      JSON.stringify({ userId: user.id, kind: "google_calendar", nonce: crypto.randomUUID() }),
    );
    const url = buildAuthorizationUrl({ kind: "google_calendar", state, redirectUri: redirectUri("google_calendar") });
    redirect(url);
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
    await revokeToken(token.access_token).catch(() => {/* best-effort */});
  }

  await supabase.from("integration_tokens").delete().eq("integration_id", integrationId);
  await supabase.from("integrations").update({ status: "revoked" }).eq("id", integrationId);

  await supabase.from("notifications").insert({
    user_id: user.id,
    application_id: null,
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

  const result = await syncGmailMessages({
    supabase,
    userId: user.id,
    integrationId,
    accessToken: token.access_token as string,
    refreshToken: token.refresh_token as string | null,
    applications: candidates,
  });

  await supabase.from("notifications").insert({
    user_id: user.id,
    application_id: null,
    title: "Gmail sync complete",
    body: `Processed ${result.processed} emails · ${result.classified} relevant · ${result.associated} associated · ${result.interviewsDetected} interview(s) detected.${result.errors.length ? ` ${result.errors.length} error(s).` : ""}`,
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

  await confirmAndCreateCalendarEvent({
    supabase,
    userId: user.id,
    integrationId,
    calendarEventId,
    accessToken: token.access_token as string,
    refreshToken: token.refresh_token as string | null,
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
      await deleteCalendarEvent({
        supabase,
        userId: user.id,
        integrationId: event.integration_id as string,
        calendarEventId,
        accessToken: token.access_token as string,
        refreshToken: token.refresh_token as string | null,
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

// ── Handle OAuth callback (called from route handler) ────────────────────────

export async function handleOAuthCallback(input: {
  code: string;
  kind: OAuthKind;
  userId: string;
}): Promise<{ success: boolean; error?: string }> {
  const { createServerSupabaseClient } = await import("@/lib/supabase/server");
  const supabase = await createServerSupabaseClient();

  try {
    const tokens = await exchangeCodeForTokens({ code: input.code, redirectUri: redirectUri(input.kind) });

    // Upsert integration row
    const { data: integration, error: intErr } = await supabase
      .from("integrations")
      .upsert(
        {
          user_id: input.userId,
          provider: "google",
          kind: input.kind,
          status: "connected",
          scopes: input.kind === "gmail"
            ? ["https://www.googleapis.com/auth/gmail.readonly"]
            : ["https://www.googleapis.com/auth/calendar.events"],
          account_label: tokens.email || null,
        },
        { onConflict: "user_id,provider,kind" },
      )
      .select("id")
      .single();

    if (intErr || !integration) {
      return { success: false, error: intErr?.message ?? "Could not upsert integration." };
    }

    // Store token (server-side only)
    await supabase
      .from("integration_tokens")
      .upsert(
        {
          integration_id: integration.id,
          user_id: input.userId,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
          scopes: input.kind === "gmail"
            ? ["https://www.googleapis.com/auth/gmail.readonly"]
            : ["https://www.googleapis.com/auth/calendar.events"],
        },
        { onConflict: "integration_id" },
      );

    await supabase.from("notifications").insert({
      user_id: input.userId,
      application_id: null,
      title: `${input.kind === "gmail" ? "Gmail" : "Google Calendar"} connected`,
      body: `Connected as ${tokens.email || "unknown"}. No passwords stored.`,
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
