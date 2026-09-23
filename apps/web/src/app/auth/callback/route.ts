import { NextResponse } from "next/server";

import { logError, logInfo } from "@/lib/log";
import { safeNextPath } from "@/lib/auth-errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Behind Caddy (`:80 → localhost:3000`), `request.url` origin is often
 * `http://localhost:3000`, which would send the browser to localhost after
 * email confirm. Prefer the public app URL when set.
 */
function publicOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;

  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = publicOrigin(request);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"), "/app/onboarding/consent");
  const destination = next.startsWith("/app/onboarding") ? next : "/app?afterAuth=1";

  if (!code) {
    const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
    const redirectUrl = new URL("/sign-in", origin);
    if (error) redirectUrl.searchParams.set("error", error);
    return NextResponse.redirect(redirectUrl);
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logError("auth.callback_failed", { code: error.code });
      return NextResponse.redirect(new URL("/sign-in?error=callback", origin));
    }
    logInfo("auth.callback_succeeded");
  } catch {
    return NextResponse.redirect(new URL("/sign-in?reason=not-configured", origin));
  }

  return NextResponse.redirect(new URL(destination, origin));
}
