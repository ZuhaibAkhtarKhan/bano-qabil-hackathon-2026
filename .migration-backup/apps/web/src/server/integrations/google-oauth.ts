/**
 * Google OAuth 2.0 helpers.
 * Secrets stay server-side. No passwords are ever requested or stored.
 * Access tokens are stored server-side only (AES-GCM when an OAuth secret is configured).
 * They are never sent to the browser or extension.
 */

import { loadAppConfig } from "@/config/env";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email",
].join(" ");

export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
].join(" ");

export type OAuthKind = "gmail" | "google_calendar";

function getConfig() {
  const cfg = loadAppConfig();
  if (!cfg.googleOAuthConfigured) throw new OAuthConfigError("Google OAuth is not configured.");
  return cfg;
}

export class OAuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthConfigError";
  }
}

export class OAuthTokenError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "OAuthTokenError";
  }
}

export function oauthRedirectUri(kind: OAuthKind): string {
  return `${loadAppConfig().appUrl.replace(/\/$/, "")}/api/integrations/callback?kind=${kind}`;
}

export function buildAuthorizationUrl(input: {
  kind: OAuthKind;
  state: string;
  redirectUri: string;
}): string {
  const cfg = getConfig();
  const scopes = input.kind === "gmail" ? GMAIL_SCOPES : CALENDAR_SCOPES;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: scopes,
    access_type: "offline",
    prompt: "consent",
    state: input.state,
  });
  void cfg;
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(input: {
  code: string;
  redirectUri: string;
}): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number; email: string }> {
  getConfig();
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = (await resp.json()) as Record<string, unknown>;
  if (!resp.ok || json.error) {
    throw new OAuthTokenError(
      `Token exchange failed: ${String(json.error_description ?? json.error ?? "unknown")}`,
      String(json.error ?? "TOKEN_EXCHANGE_FAILED"),
    );
  }
  const idToken = String(json.id_token ?? "");
  let email = "";
  if (idToken) {
    try {
      const payload = JSON.parse(Buffer.from(idToken.split(".")[1]!, "base64url").toString());
      email = String(payload.email ?? "");
    } catch { /* ignore decode error */ }
  }
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : null,
    expiresIn: Number(json.expires_in ?? 3600),
    email,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  getConfig();
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  const json = (await resp.json()) as Record<string, unknown>;
  if (!resp.ok || json.error) {
    const code = String(json.error ?? "REFRESH_FAILED");
    if (code === "invalid_grant") throw new OAuthTokenError("Refresh token revoked or expired.", "REVOKED");
    throw new OAuthTokenError(`Token refresh failed: ${String(json.error_description ?? code)}`, code);
  }
  return { accessToken: String(json.access_token), expiresIn: Number(json.expires_in ?? 3600) };
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" });
}
