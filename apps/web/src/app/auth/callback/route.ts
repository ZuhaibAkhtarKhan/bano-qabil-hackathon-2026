import { NextResponse } from "next/server";

import { logError, logInfo } from "@/lib/log";
import { safeNextPath } from "@/lib/auth-errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"), "/app/onboarding/consent");
  const destination = next.startsWith("/app/onboarding") ? next : "/app?afterAuth=1";

  if (!code) {
    const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
    const redirectUrl = new URL("/sign-in", url.origin);
    if (error) redirectUrl.searchParams.set("error", error);
    return NextResponse.redirect(redirectUrl);
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logError("auth.callback_failed", { code: error.code });
      return NextResponse.redirect(new URL("/sign-in?error=callback", url.origin));
    }
    logInfo("auth.callback_succeeded");
  } catch {
    return NextResponse.redirect(new URL("/sign-in?reason=not-configured", url.origin));
  }

  return NextResponse.redirect(new URL(destination, url.origin));
}
