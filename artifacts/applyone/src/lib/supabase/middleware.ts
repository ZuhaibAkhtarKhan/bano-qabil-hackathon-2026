import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { onboardingHref } from "@1apply/contracts";

import { safeNextPath } from "@/lib/auth-errors";
import { isSupabaseConfigured } from "@/lib/env";
import { hasConsent, onboardingComplete } from "@/lib/profile-state";

const PROFILE_FIELDS =
  "id, email, display_name, headline, phone, terms_accepted_at, ai_processing_accepted_at, onboarding_completed_at, onboarding_step, preferences";

export async function updateSession(request: NextRequest) {
  const response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  const isApp = path.startsWith("/app");
  const isWorkspace = isApp && !path.startsWith("/app/onboarding");
  const isOnboarding = path.startsWith("/app/onboarding");
  const isAuthPage =
    path === "/sign-in" || path === "/sign-up" || path === "/forgot-password" || path === "/reset-password";

  if (!isSupabaseConfigured()) {
    if (isApp) {
      const url = request.nextUrl.clone();
      url.pathname = "/sign-in";
      url.searchParams.set("reason", "not-configured");
      return NextResponse.redirect(url);
    }
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isApp && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (isAuthPage && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && isApp) {
    const { data: profile } = await supabase.from("profiles").select(PROFILE_FIELDS).eq("id", user.id).maybeSingle();

    if (profile) {
      const profileRow = {
        ...profile,
        preferences: (profile.preferences as Record<string, unknown> | null) ?? {},
      };

      if (path === "/app/consent") {
        const url = request.nextUrl.clone();
        url.pathname = hasConsent(profileRow) ? "/app/onboarding/profile" : "/app/onboarding/consent";
        url.search = "";
        return NextResponse.redirect(url);
      }

      if (isWorkspace && !onboardingComplete(profileRow)) {
        const url = request.nextUrl.clone();
        url.pathname = onboardingHref(
          (profileRow.onboarding_step as Parameters<typeof onboardingHref>[0]) ?? "consent",
        );
        url.search = "";
        return NextResponse.redirect(url);
      }

      if (isOnboarding && onboardingComplete(profileRow)) {
        const url = request.nextUrl.clone();
        url.pathname = "/app";
        url.search = "";
        return NextResponse.redirect(url);
      }
    }
  }

  if (path === "/sign-in" && request.nextUrl.searchParams.get("next")) {
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    if (next !== request.nextUrl.searchParams.get("next")) {
      const url = request.nextUrl.clone();
      url.searchParams.set("next", next);
      return NextResponse.redirect(url);
    }
  }

  return response;
}
