import { NextResponse } from "next/server";

import { getCurrentUserAndProfile } from "@/lib/profile";
import { handleOAuthCallback } from "@/server/integrations/oauth-callback";
import type { OAuthKind } from "@/server/integrations/google-oauth";
import { OAUTH_STATE_COOKIE, oauthStateMatches } from "@/server/integrations/oauth-state";

const KINDS: OAuthKind[] = ["gmail", "google_calendar"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const kindParam = url.searchParams.get("kind");
  const kind = KINDS.includes(kindParam as OAuthKind) ? (kindParam as OAuthKind) : null;
  const state = url.searchParams.get("state");

  const redirect = (path: string) => {
    const response = NextResponse.redirect(`${url.origin}${path}`);
    response.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  };

  if (error || !code || !kind) {
    return redirect(`/app/integrations?error=${error ? "oauth_denied" : "missing_code"}`);
  }

  const { user } = await getCurrentUserAndProfile();
  if (!user) {
    return redirect("/sign-in");
  }

  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${OAUTH_STATE_COOKIE}=`))
    ?.slice(`${OAUTH_STATE_COOKIE}=`.length);

  const decoded = cookie ? decodeURIComponent(cookie) : undefined;
  if (!oauthStateMatches({ cookie: decoded, state, userId: user.id, kind })) {
    return redirect("/app/integrations?error=oauth_state");
  }

  const result = await handleOAuthCallback({ code, kind, userId: user.id });
  if (!result.success) {
    return redirect(`/app/integrations?error=${result.error.toLowerCase()}`);
  }

  return redirect("/app/integrations");
}
