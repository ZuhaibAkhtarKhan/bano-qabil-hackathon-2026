import { NextResponse } from "next/server";

import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { toActor, type Actor } from "@/auth/actor";
import type { ProfileRow } from "@/lib/profile";
import { hasConsent } from "@/lib/profile-state";
import { isPrivilegedJwt } from "@/lib/security/jwt";
import { createAccessTokenSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { onboardingStepSchema } from "@1apply/contracts";

export class ApiAuthError extends Error {
  constructor(
    readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_CONFIGURED",
    readonly status: 401 | 403 | 503,
    message: string,
  ) {
    super(message);
    this.name = "ApiAuthError";
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

async function loadProfile(supabase: SupabaseClient, user: User): Promise<ProfileRow | null> {
  const { data } = await supabase
    .from("profiles")
    .select(
      "id, email, display_name, headline, phone, terms_accepted_at, ai_processing_accepted_at, onboarding_completed_at, onboarding_step, preferences",
    )
    .eq("id", user.id)
    .maybeSingle();
  if (!data) return null;
  const step = onboardingStepSchema.safeParse(data.onboarding_step);
  return {
    ...(data as ProfileRow),
    onboarding_step: step.success ? step.data : "consent",
    preferences: (data.preferences as Record<string, unknown> | null) ?? {},
  };
}

export async function requireApiSession(request: Request): Promise<{
  user: User;
  profile: ProfileRow;
  supabase: SupabaseClient;
  actor: Actor;
}> {
  if (!isSupabaseConfigured()) {
    throw new ApiAuthError("NOT_CONFIGURED", 503, "Supabase is not configured.");
  }

  const cookieClient = await createServerSupabaseClient();
  const cookieUser = (await cookieClient.auth.getUser()).data.user;
  let supabase = cookieClient;
  let user = cookieUser;

  if (!user) {
    const token = bearerToken(request);
    if (!token) {
      throw new ApiAuthError("UNAUTHENTICATED", 401, "Sign in required.");
    }
    if (isPrivilegedJwt(token)) {
      throw new ApiAuthError("UNAUTHENTICATED", 401, "Privileged credentials are not accepted.");
    }
    supabase = createAccessTokenSupabaseClient(token);
    user = (await supabase.auth.getUser(token)).data.user;
  }

  if (!user) {
    throw new ApiAuthError("UNAUTHENTICATED", 401, "Sign in required.");
  }

  const profile = await loadProfile(supabase, user);
  if (!profile) {
    throw new ApiAuthError("UNAUTHENTICATED", 401, "Sign in required.");
  }
  if (!hasConsent(profile)) {
    throw new ApiAuthError("FORBIDDEN", 403, "Consent is required.");
  }

  return { user, profile, supabase, actor: toActor(user, profile) };
}

export function apiAuthResponse(
  error: ApiAuthError,
  envelope: { parse: (value: unknown) => unknown },
  requestId: string,
) {
  return NextResponse.json(
    envelope.parse({
      data: null,
      error: { code: error.code, message: error.message },
      requestId,
    }),
    { status: error.status },
  );
}
