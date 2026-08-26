import {
  canFinishOnboarding,
  consentUpdateFields,
  onboardingStepSchema,
  resolveOnboardingStep,
  type OnboardingStep,
} from "@1apply/contracts";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { hasConsent, onboardingComplete, skippedDocuments } from "@/lib/profile-state";
import { parseWorkspacePreferences } from "@/lib/workspace-preferences";
import type { ProfileDetails, EvidenceRow } from "@/server/types";

export type ProfileRow = {
  id: string;
  email: string;
  display_name: string | null;
  headline: string | null;
  phone: string | null;
  terms_accepted_at: string | null;
  ai_processing_accepted_at: string | null;
  onboarding_completed_at: string | null;
  onboarding_step: OnboardingStep;
  preferences: Record<string, unknown> | null;
  timezone: string | null;
};

export { hasConsent, onboardingComplete, skippedDocuments };

function parseOnboardingStep(value: string | null | undefined): OnboardingStep | null {
  const parsed = onboardingStepSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function getCurrentUserAndProfile() {
  if (!isSupabaseConfigured()) {
    return { user: null, profile: null as ProfileRow | null };
  }
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return { user: null, profile: null as ProfileRow | null };
  }

  const { data: existing } = await supabase
    .from("profiles")
    .select(
      "id, email, display_name, headline, phone, terms_accepted_at, ai_processing_accepted_at, onboarding_completed_at, onboarding_step, preferences, timezone",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (existing) {
    return {
      user,
      profile: {
        ...(existing as ProfileRow),
        onboarding_step: parseOnboardingStep(existing.onboarding_step) ?? "consent",
        preferences: (existing.preferences as Record<string, unknown> | null) ?? {},
      },
    };
  }

  const { data: created, error } = await supabase
    .from("profiles")
    .insert({
      id: user.id,
      email: user.email,
      display_name: (user.user_metadata.display_name as string | undefined) ?? user.email.split("@")[0],
      onboarding_step: "consent",
    })
    .select(
      "id, email, display_name, headline, phone, terms_accepted_at, ai_processing_accepted_at, onboarding_completed_at, onboarding_step, preferences, timezone",
    )
    .single();

  if (error) {
    return { user, profile: null as ProfileRow | null };
  }

  return {
    user,
    profile: {
      ...(created as ProfileRow),
      onboarding_step: parseOnboardingStep(created.onboarding_step) ?? "consent",
      preferences: (created.preferences as Record<string, unknown> | null) ?? {},
    },
  };
}

export async function loadOnboardingState() {
  const { user, profile } = await getCurrentUserAndProfile();
  if (!user || !profile) {
    return null;
  }

  const supabase = await createServerSupabaseClient();
  const [{ count: documentCount }, { count: evidenceCount }, { count: verifiedEvidenceCount }, { data: evidence }, { data: documents }] =
    await Promise.all([
      supabase.from("documents").select("id", { count: "exact", head: true }),
      supabase.from("evidence_items").select("id", { count: "exact", head: true }),
      supabase
        .from("evidence_items")
        .select("id", { count: "exact", head: true })
        .eq("verification_status", "verified")
        .eq("excluded_from_ai", false),
      supabase
        .from("evidence_items")
        .select(
          "id, title, kind, organization, situation, action, outcome, skills, source, verification_status, excluded_from_ai, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(40),
      supabase.from("documents").select("id, type, label").order("created_at", { ascending: false }),
    ]);

  const prefs = parseWorkspacePreferences(profile.preferences);
  const hasIdentity = Boolean(profile.display_name?.trim());
  const consent = hasConsent(profile);
  const skipped = skippedDocuments(profile);
  const step = resolveOnboardingStep({
    hasConsent: consent,
    hasIdentity,
    hasUniversity: Boolean(prefs.university),
    hasEducation: Boolean(prefs.educationSummary) || Boolean(prefs.university),
    documentCount: documentCount ?? 0,
    evidenceCount: evidenceCount ?? 0,
    skippedDocuments: skipped,
    onboardingCompleted: onboardingComplete(profile),
    storedStep: profile.onboarding_step,
  });

  return {
    user,
    profile,
    step,
    documentCount: documentCount ?? 0,
    evidenceCount: evidenceCount ?? 0,
    verifiedEvidenceCount: verifiedEvidenceCount ?? 0,
    evidence: (evidence ?? []) as EvidenceRow[],
    documents: (documents ?? []) as Array<{ id: string; type: string; label: string }>,
    canFinish: canFinishOnboarding({ hasConsent: consent, hasIdentity }),
    consentUpdateFields,
  };
}

export async function loadOnboardingProfileDetails() {
  const { user, profile } = await getCurrentUserAndProfile();
  if (!user || !profile) return null;

  const supabase = await createServerSupabaseClient();
  const { data: full } = await supabase
    .from("profiles")
    .select(
      "id, email, display_name, headline, phone, location_city, location_country, linkedin_url, github_url, portfolio_url, availability, work_authorization",
    )
    .eq("id", user.id)
    .single();

  return {
    profile,
    details: (full as ProfileDetails | null) ?? {
      id: profile.id,
      email: profile.email,
      display_name: profile.display_name,
      headline: profile.headline,
      phone: profile.phone,
      location_city: null,
      location_country: null,
      linkedin_url: null,
      github_url: null,
      portfolio_url: null,
      availability: null,
      work_authorization: null,
      timezone: null,
    },
  };
}
