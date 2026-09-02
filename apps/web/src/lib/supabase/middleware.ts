import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { onboardingHref } from "@1apply/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { safeNextPath } from "@/lib/auth-errors";
import { isSupabaseConfigured } from "@/lib/env";
import { destinationAfterAuth, KIT_REMINDED_COOKIE } from "@/lib/post-auth";
import { hasConsent, onboardingComplete } from "@/lib/profile-state";

const PROFILE_FIELDS =
  "id, email, display_name, headline, phone, terms_accepted_at, ai_processing_accepted_at, onboarding_completed_at, onboarding_step, preferences";

function redirectWithSession(url: URL, from: NextResponse, kitReminded = false) {
  const next = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) {
    next.cookies.set(cookie);
  }
  if (kitReminded) {
    next.cookies.set(KIT_REMINDED_COOKIE, "1", { path: "/", sameSite: "lax" });
  }
  return next;
}

async function landingPath(
  supabase: SupabaseClient,
  userId: string,
  profile: {
    display_name: string | null;
    onboarding_completed_at: string | null;
    onboarding_step: string | null;
    preferences: Record<string, unknown>;
  },
) {
  const { data: documents } = await supabase.from("documents").select("type, label").eq("user_id", userId);
  return destinationAfterAuth({
    onboardingCompletedAt: profile.onboarding_completed_at,
    onboardingStep: profile.onboarding_step,
    displayName: profile.display_name,
    preferences: profile.preferences,
    documents: documents ?? [],
  });
}

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", path);
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
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
    const { data: profile } = await supabase.from("profiles").select(PROFILE_FIELDS).eq("id", user.id).maybeSingle();
    const dest = profile
      ? await landingPath(supabase, user.id, {
          display_name: profile.display_name,
          onboarding_completed_at: profile.onboarding_completed_at,
          onboarding_step: profile.onboarding_step,
          preferences: (profile.preferences as Record<string, unknown> | null) ?? {},
        })
      : "/app";
    const reminded = request.cookies.get(KIT_REMINDED_COOKIE)?.value === "1";
    const target = dest.includes("remind=kit") && reminded ? "/app" : dest;
    const url = new URL(target, request.url);
    return redirectWithSession(url, response, dest.includes("remind=kit") && !reminded);
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

      if (path === "/app" && request.nextUrl.searchParams.get("afterAuth") === "1") {
        const dest = await landingPath(supabase, user.id, {
          display_name: profileRow.display_name,
          onboarding_completed_at: profileRow.onboarding_completed_at,
          onboarding_step: profileRow.onboarding_step,
          preferences: profileRow.preferences,
        });
        const url = new URL(dest, request.url);
        return redirectWithSession(url, response, dest.includes("remind=kit"));
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
