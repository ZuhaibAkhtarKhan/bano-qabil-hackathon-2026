"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logError } from "@/lib/log";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { mergeWorkspacePreferences } from "@/lib/workspace-preferences";

export async function saveOnboardingProfile(formData: FormData) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=/app/onboarding/profile");

  const displayName = String(formData.get("displayName") ?? "").trim();
  const university = String(formData.get("university") ?? "").trim();
  const educationSummary = String(formData.get("educationSummary") ?? "").trim();
  if (!displayName || !university || !educationSummary) {
    redirect("/app/onboarding/profile?error=required");
  }

  const { data: existing } = await supabase.from("profiles").select("preferences").eq("id", user.id).maybeSingle();
  const preferences = mergeWorkspacePreferences((existing?.preferences as Record<string, unknown> | null) ?? {}, {
    university,
    educationSummary,
  });

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      headline: String(formData.get("headline") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      location_city: String(formData.get("locationCity") ?? "").trim() || null,
      location_country: String(formData.get("locationCountry") ?? "").trim() || null,
      availability: String(formData.get("availability") ?? "").trim() || null,
      work_authorization: String(formData.get("workAuthorization") ?? "").trim() || null,
      linkedin_url: String(formData.get("linkedinUrl") ?? "").trim() || null,
      github_url: String(formData.get("githubUrl") ?? "").trim() || null,
      portfolio_url: String(formData.get("portfolioUrl") ?? "").trim() || null,
      preferences,
      onboarding_step: "documents",
    })
    .eq("id", user.id);

  if (error) {
    logError("onboarding.profile_save_failed", { code: error.code });
    redirect("/app/onboarding/profile?error=save");
  }

  revalidatePath("/app/onboarding");
  revalidatePath("/app/memory");
  redirect("/app/onboarding/documents");
}

export async function continueOnboardingReview() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=/app/onboarding/review");

  await supabase.from("profiles").update({ onboarding_step: "review" }).eq("id", user.id);
  revalidatePath("/app/onboarding");
  redirect("/app/onboarding/review");
}

export async function continueOnboardingReady() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=/app/onboarding/ready");

  await supabase.from("profiles").update({ onboarding_step: "ready" }).eq("id", user.id);
  revalidatePath("/app/onboarding");
  redirect("/app/onboarding/ready");
}
