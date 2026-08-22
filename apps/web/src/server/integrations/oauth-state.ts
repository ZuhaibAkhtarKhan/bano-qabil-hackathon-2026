import { createHmac } from "node:crypto";
import { cookies } from "next/headers";

import type { OAuthKind } from "@/server/integrations/google-oauth";

export const OAUTH_STATE_COOKIE = "1apply_oauth_state";

export type OAuthStatePayload = {
  token: string;
  kind: OAuthKind;
  userId: string;
  expiresAt: number;
};

function isOAuthKind(value: unknown): value is OAuthKind {
  return value === "gmail" || value === "google_calendar";
}

function signingSecret(): string {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
  return secret && !secret.startsWith("replace-with") ? secret : "1apply-dev-oauth-state";
}

function sign(body: string): string {
  return createHmac("sha256", signingSecret()).update(body).digest("base64url");
}

export function createOAuthState(kind: OAuthKind, userId: string): OAuthStatePayload {
  return {
    token: crypto.randomUUID(),
    kind,
    userId,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
}

export function serializeOAuthState(payload: OAuthStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function parseOAuthState(raw: string | undefined | null): OAuthStatePayload | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw);
    const [body, signature] = decoded.split(".");
    if (!body || !signature || sign(body) !== signature) return null;
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<OAuthStatePayload>;
    if (!parsed.token || !isOAuthKind(parsed.kind) || !parsed.userId || typeof parsed.expiresAt !== "number") {
      return null;
    }
    if (parsed.expiresAt < Date.now()) return null;
    return parsed as OAuthStatePayload;
  } catch {
    return null;
  }
}

export function oauthStateMatches(input: {
  cookie: string | undefined;
  state: string | null;
  userId: string;
  kind: OAuthKind;
}): boolean {
  const payload = parseOAuthState(input.cookie);
  if (!payload) return false;
  return payload.token === input.state && payload.userId === input.userId && payload.kind === input.kind;
}

export async function storeOAuthState(payload: OAuthStatePayload): Promise<void> {
  const jar = await cookies();
  jar.set(OAUTH_STATE_COOKIE, serializeOAuthState(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
}

export function clearOAuthStateCookie(headers: Headers): void {
  headers.append(
    "Set-Cookie",
    `${OAUTH_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
  );
}
