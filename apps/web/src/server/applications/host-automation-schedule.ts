import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { logError } from "@/lib/log";
import { parseWorkspacePreferences } from "@/lib/workspace-preferences";

import {
  queueHostPrefillJob,
  scheduleHostSubmitJob,
  scheduleHostSubmitWhenFullyComplete,
} from "./host-submit";
import { kickHostSubmitWorkerIfEnabled } from "./host-submit-worker-kick";
import { isServerHostSubmitEnabled } from "./playwright-host-submit";
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

  if (!isServerHostSubmitEnabled()) {
    logError("host_automation.server_submit_disabled", {
      applicationId: input.applicationId,
      hint: "ENABLE_SERVER_HOST_SUBMIT must be true — host fill/submit is server-only.",
    });
    return;
  }

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
  if (!submit.ok && submit.reason === "no_deadline") {
    const complete = await scheduleHostSubmitWhenFullyComplete({
      supabase: input.supabase,
      actor: input.actor,
      applicationId: input.applicationId,
    });
    if (
      !complete.ok &&
      complete.reason !== "not_ready" &&
      complete.reason !== "open_needs_you"
    ) {
      logError("host_automation.no_deadline_submit_failed", {
        applicationId: input.applicationId,
        reason: complete.reason,
      });
    }
  } else if (!submit.ok) {
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

  // Run worker immediately when jobs are due — do not rely on after() alone.
  await kickHostSubmitWorkerIfEnabled();
}

/** After Need You edits, queue host submit when every field is filled and no deadline is set. */
export async function tryNoDeadlineHostSubmitIfComplete(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
}): Promise<void> {
  const prefs = parseWorkspacePreferences(input.actor.profile.preferences);
  if (!prefs.prepareAndSendIfSilent) return;

  const result = await scheduleHostSubmitWhenFullyComplete(input);
  if (result.ok) {
    await kickHostSubmitWorkerIfEnabled();
  }
}
