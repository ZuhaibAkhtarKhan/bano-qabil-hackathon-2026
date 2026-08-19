import { NextResponse } from "next/server";

import { getCurrentUserAndProfile } from "@/lib/profile";
import { handleOAuthCallback } from "@/server/integrations/actions";
import type { OAuthKind } from "@/server/integrations/google-oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const kind = url.searchParams.get("kind") as OAuthKind | null;

  if (error || !code || !kind) {
    const reason = error ?? "missing_code";
    return NextResponse.redirect(`${url.origin}/app/integrations?error=${encodeURIComponent(reason)}`);
  }

  const { user } = await getCurrentUserAndProfile();
  if (!user) {
    return NextResponse.redirect(`${url.origin}/sign-in`);
  }

  const result = await handleOAuthCallback({ code, kind, userId: user.id });

  if (!result.success) {
    return NextResponse.redirect(
      `${url.origin}/app/integrations?error=${encodeURIComponent(result.error ?? "callback_failed")}`,
    );
  }

  return NextResponse.redirect(`${url.origin}/app/integrations`);
}
