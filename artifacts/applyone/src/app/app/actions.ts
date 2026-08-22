"use server";

import { consentInputSchema, consentUpdateFields } from "@1apply/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logError, logInfo } from "@/lib/log";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { safeOnboardingReturn } from "@/lib/auth-errors";
import { revokeToken } from "@/server/integrations/google-oauth";
import { unwrapTokenRow } from "@/server/integrations/token-crypto";
import { recordAuditEvent } from "@/server/audit";

export async function signOut() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: tokens } = await supabase
      .from("integration_tokens")
      .select("access_token, refresh_token")
      .eq("user_id", user.id);
    for (const row of tokens ?? []) {
      const secrets = unwrapTokenRow(row);
      await revokeToken(secrets.accessToken).catch(() => {
        /* best-effort */
      });
      if (secrets.refreshToken) {
        await revokeToken(secrets.refreshToken).catch(() => {
          /* best-effort */
        });
      }
    }
    await supabase.from("integration_tokens").delete().eq("user_id", user.id);
    await supabase.from("integrations").update({ status: "revoked" }).eq("user_id", user.id);
    await recordAuditEvent(supabase, "auth.sign_out", {});
  }
  await supabase.auth.signOut();
  logInfo("auth.sign_out");
  redirect("/");
}

export async function acceptConsent(formData: FormData) {
  const parsed = consentInputSchema.safeParse({
    termsAccepted: formData.get("termsAccepted") === "on",
    aiProcessingAccepted: formData.get("aiProcessingAccepted") === "on",
  });

  if (!parsed.success) {
    redirect("/app/onboarding/consent?error=required");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in?next=/app/onboarding/consent");
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("profiles")
    .update(consentUpdateFields(now))
    .eq("id", user.id);

  if (error) {
    logError("consent.update_failed", { code: error.code, hint: error.hint });
    redirect("/app/onboarding/consent?error=save");
  }

  logInfo("consent.accepted", { userId: user.id });
  revalidatePath("/app");
  revalidatePath("/app/onboarding");
  redirect("/app/onboarding/profile");
}

export async function skipOnboardingDocuments() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=/app/onboarding/documents");

  const { data: profile } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", user.id)
    .maybeSingle();

  const preferences = {
    ...((profile?.preferences as Record<string, unknown> | null) ?? {}),
    onboardingSkippedDocuments: true,
  };

  const { error } = await supabase
    .from("profiles")
    .update({ onboarding_step: "review", preferences })
    .eq("id", user.id);

  if (error) {
    logError("onboarding.skip_documents_failed", { code: error.code });
    redirect("/app/onboarding/documents?error=save");
  }

  revalidatePath("/app/onboarding");
  redirect("/app/onboarding/review");
}

export async function finishOnboarding() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=/app/onboarding/ready");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, terms_accepted_at, ai_processing_accepted_at")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.terms_accepted_at || !profile.ai_processing_accepted_at || !profile.display_name?.trim()) {
    redirect("/app/onboarding/profile?error=required");
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("profiles")
    .update({
      onboarding_completed_at: now,
      onboarding_step: "done",
    })
    .eq("id", user.id);

  if (error) {
    logError("onboarding.finish_failed", { code: error.code });
    redirect("/app/onboarding/ready?error=save");
  }

  logInfo("onboarding.completed", { userId: user.id });
  revalidatePath("/app");
  redirect("/app");
}

export async function verifyOnboardingEvidence(formData: FormData) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=/app/onboarding/review");

  const evidenceId = String(formData.get("evidenceId") ?? "");
  const returnTo = safeOnboardingReturn(formData.get("returnTo")) ?? "/app/onboarding/review";
  if (!evidenceId) redirect(`${returnTo}?error=required`);

  const { error } = await supabase
    .from("evidence_items")
    .update({ verification_status: "verified" })
    .eq("id", evidenceId);

  if (error) {
    redirect(`${returnTo}?error=save`);
  }

  revalidatePath("/app/onboarding");
  revalidatePath("/app/memory");
  redirect(`${returnTo}?notice=verified`);
}

export async function verifyAllExtractedEvidence(formData: FormData) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in?next=/app/onboarding/review");

  const returnTo = safeOnboardingReturn(formData.get("returnTo")) ?? "/app/onboarding/review";
  const { error } = await supabase
    .from("evidence_items")
    .update({ verification_status: "verified" })
    .eq("user_id", user.id)
    .eq("verification_status", "unverified")
    .eq("excluded_from_ai", false);

  if (error) {
    redirect(`${returnTo}?error=save`);
  }

  revalidatePath("/app/onboarding");
  revalidatePath("/app/memory");
  redirect(`${returnTo}?notice=verified`);
}
