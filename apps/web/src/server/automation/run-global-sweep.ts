import { onboardingStepSchema } from "@1apply/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { logError } from "@/lib/log";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/admin";
import type { ProfileRow } from "@/lib/profile";
import { runUserAutomationSweep } from "@/server/automation/sweep";

const OPEN_STATUSES = [
  "saved",
  "analyzing",
  "ready_to_apply",
  "in_progress",
  "review_required",
  "draft",
  "preparing",
  "ready",
];

function mapProfile(row: Record<string, unknown>): ProfileRow {
  const step = onboardingStepSchema.safeParse(row.onboarding_step);
  return {
    id: String(row.id),
    email: String(row.email ?? ""),
    display_name: (row.display_name as string | null) ?? null,
    headline: (row.headline as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    terms_accepted_at: (row.terms_accepted_at as string | null) ?? null,
    ai_processing_accepted_at: (row.ai_processing_accepted_at as string | null) ?? null,
    onboarding_completed_at: (row.onboarding_completed_at as string | null) ?? null,
    onboarding_step: step.success ? step.data : "consent",
    preferences: (row.preferences as Record<string, unknown> | null) ?? {},
    timezone: (row.timezone as string | null) ?? null,
  };
}

async function loadActiveUserIds(supabase: SupabaseClient): Promise<string[]> {
  const { data: applications } = await supabase
    .from("applications")
    .select("user_id")
    .in("status", OPEN_STATUSES)
    .limit(500);

  return [...new Set((applications ?? []).map((row) => String(row.user_id)).filter(Boolean))].slice(0, 40);
}

/**
 * Runs deadline automation for every user with open applications.
 * Used by EC2 cron — no browser tab required.
 */
export async function runGlobalAutomationSweep(): Promise<{
  usersProcessed: number;
  userErrors: number;
}> {
  const supabase = createServiceRoleSupabaseClient();
  const userIds = await loadActiveUserIds(supabase);
  let usersProcessed = 0;
  let userErrors = 0;

  for (const userId of userIds) {
    try {
      const { data: profileRow, error } = await supabase
        .from("profiles")
        .select(
          "id, email, display_name, headline, phone, terms_accepted_at, ai_processing_accepted_at, onboarding_completed_at, onboarding_step, preferences, timezone",
        )
        .eq("id", userId)
        .maybeSingle();

      if (error || !profileRow?.email) continue;

      const profile = mapProfile(profileRow as Record<string, unknown>);
      const actor: Actor = { userId, email: profile.email, profile };
      await runUserAutomationSweep(supabase, actor);
      usersProcessed += 1;
    } catch (err) {
      userErrors += 1;
      logError("automation.global_sweep_user_failed", { err, userId });
    }
  }

  return { usersProcessed, userErrors };
}

/** Process queued host submit jobs with headless Playwright (no extension). */
export async function runGlobalHostSubmitWorker() {
  const supabase = createServiceRoleSupabaseClient();
  const { reconcileOverdueHostSubmitJobs } = await import("@/server/applications/host-submit");
  await reconcileOverdueHostSubmitJobs(supabase);
  const { runServerHostSubmitWorker } = await import("@/server/applications/host-submit-worker");
  return runServerHostSubmitWorker(supabase);
}
