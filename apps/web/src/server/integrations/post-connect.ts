import type { SupabaseClient } from "@supabase/supabase-js";

import { importUpcomingCalendarEvents } from "@/server/integrations/calendar-sync";
import { syncGmailMessages } from "@/server/integrations/gmail-sync";
import type { OAuthKind } from "@/server/integrations/google-oauth";
import { unwrapTokenRow } from "@/server/integrations/token-crypto";

async function loadApplicationCandidates(supabase: SupabaseClient, userId: string) {
  const { data: applications } = await supabase
    .from("applications")
    .select("id, opportunity_id, opportunities ( title, organization, source_url )")
    .eq("user_id", userId);

  return (applications ?? []).map((app) => {
    const opp = Array.isArray(app.opportunities) ? app.opportunities[0] : app.opportunities;
    return {
      id: app.id as string,
      opportunityTitle: (opp as { title?: string } | null)?.title ?? "",
      organization: (opp as { organization?: string | null } | null)?.organization ?? null,
      sourceUrl: (opp as { source_url?: string | null } | null)?.source_url ?? null,
      status: "",
    };
  });
}

export async function runPostConnectSync(input: {
  supabase: SupabaseClient;
  userId: string;
  kind: OAuthKind;
  integrationId: string;
}): Promise<void> {
  const { data: token } = await input.supabase
    .from("integration_tokens")
    .select("access_token, refresh_token")
    .eq("integration_id", input.integrationId)
    .maybeSingle();
  if (!token?.access_token) return;

  const secrets = unwrapTokenRow(token);
  if (input.kind === "gmail") {
    await syncGmailMessages({
      supabase: input.supabase,
      userId: input.userId,
      integrationId: input.integrationId,
      accessToken: secrets.accessToken,
      refreshToken: secrets.refreshToken,
      applications: await loadApplicationCandidates(input.supabase, input.userId),
    });
    return;
  }

  await importUpcomingCalendarEvents({
    supabase: input.supabase,
    userId: input.userId,
    integrationId: input.integrationId,
    accessToken: secrets.accessToken,
    refreshToken: secrets.refreshToken,
  });
}
