import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { parseWorkspacePreferences } from "@/lib/workspace-preferences";

import {
  queueHostPrefillJob,
  scheduleHostSubmitJob,
} from "./host-submit";
import { maybeSendPreDeadlineReviewForApplication } from "./pre-deadline-review-email";

/** Queue immediate server prefill + schedule submit before deadline when automation is on. */
export async function syncHostAutomationForApplication(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  queuePrefill?: boolean;
}): Promise<void> {
  const prefs = parseWorkspacePreferences(input.actor.profile.preferences);
  if (!prefs.prepareAndSendIfSilent) return;

  if (input.queuePrefill !== false) {
    await queueHostPrefillJob({
      supabase: input.supabase,
      actor: input.actor,
      applicationId: input.applicationId,
    });
  }

  await scheduleHostSubmitJob({
    supabase: input.supabase,
    actor: input.actor,
    applicationId: input.applicationId,
  });

  await maybeSendPreDeadlineReviewForApplication({
    supabase: input.supabase,
    actor: input.actor,
    applicationId: input.applicationId,
    prepareAndSendIfSilent: prefs.prepareAndSendIfSilent,
  });
}
