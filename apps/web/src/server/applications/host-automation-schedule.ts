import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

import type { Actor } from "@/auth/actor";
import { logError } from "@/lib/log";
import { parseWorkspacePreferences } from "@/lib/workspace-preferences";

import {
  queueHostPrefillJob,
  scheduleHostSubmitJob,
} from "./host-submit";
import { kickHostSubmitWorkerIfEnabled } from "./host-submit-worker-kick";
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
    const prefill = await queueHostPrefillJob({
      supabase: input.supabase,
      actor: input.actor,
      applicationId: input.applicationId,
    });
    if (!prefill.ok) {
      logError("host_automation.prefill_queue_failed", {
        applicationId: input.applicationId,
        reason: prefill.reason,
      });
    }
  }

  const submit = await scheduleHostSubmitJob({
    supabase: input.supabase,
    actor: input.actor,
    applicationId: input.applicationId,
  });
  if (!submit.ok && submit.reason !== "no_deadline") {
    logError("host_automation.submit_schedule_failed", {
      applicationId: input.applicationId,
      reason: submit.reason,
    });
  }

  await maybeSendPreDeadlineReviewForApplication({
    supabase: input.supabase,
    actor: input.actor,
    applicationId: input.applicationId,
    prepareAndSendIfSilent: prefs.prepareAndSendIfSilent,
  });

  after(() => {
    void kickHostSubmitWorkerIfEnabled();
  });
}
