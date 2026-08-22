import { emitDomainEvent } from "@/server/notifications/service";
import { exchangeCodeForTokens, oauthRedirectUri, type OAuthKind } from "@/server/integrations/google-oauth";
import { encryptSecret } from "@/server/integrations/token-crypto";

export type OAuthCallbackError =
  | "TOKEN_EXCHANGE_FAILED"
  | "REVOKED"
  | "UPSERT_FAILED"
  | "CALLBACK_FAILED";

export async function handleOAuthCallback(input: {
  code: string;
  kind: OAuthKind;
  userId: string;
}): Promise<{ success: true } | { success: false; error: OAuthCallbackError }> {
  const { createServerSupabaseClient } = await import("@/lib/supabase/server");
  const supabase = await createServerSupabaseClient();

  try {
    const tokens = await exchangeCodeForTokens({ code: input.code, redirectUri: oauthRedirectUri(input.kind) });

    const { data: integration, error: intErr } = await supabase
      .from("integrations")
      .upsert(
        {
          user_id: input.userId,
          provider: "google",
          kind: input.kind,
          status: "connected",
          scopes:
            input.kind === "gmail"
              ? ["https://www.googleapis.com/auth/gmail.readonly"]
              : ["https://www.googleapis.com/auth/calendar.events"],
          account_label: tokens.email || null,
        },
        { onConflict: "user_id,provider,kind" },
      )
      .select("id")
      .single();

    if (intErr || !integration) {
      return { success: false, error: "UPSERT_FAILED" };
    }

    await supabase.from("integration_tokens").upsert(
      {
        integration_id: integration.id,
        user_id: input.userId,
        access_token: encryptSecret(tokens.accessToken),
        refresh_token: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
        expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
        scopes:
          input.kind === "gmail"
            ? ["https://www.googleapis.com/auth/gmail.readonly"]
            : ["https://www.googleapis.com/auth/calendar.events"],
      },
      { onConflict: "integration_id" },
    );

    await emitDomainEvent(supabase, {
      name: "integration.connected",
      userId: input.userId,
      subjectId: integration.id,
      title: `${input.kind === "gmail" ? "Gmail" : "Google Calendar"} connected`,
      body: `Connected as ${tokens.email || "unknown"}. No passwords stored.`,
    });

    return { success: true };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
    if (code === "REVOKED") return { success: false, error: "REVOKED" };
    if (code === "TOKEN_EXCHANGE_FAILED" || code) return { success: false, error: "TOKEN_EXCHANGE_FAILED" };
    return { success: false, error: "CALLBACK_FAILED" };
  }
}
