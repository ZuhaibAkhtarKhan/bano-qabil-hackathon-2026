import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { logError } from "@/lib/log";
import { parseWorkspacePreferences } from "@/lib/workspace-preferences";

import {
  loadHostSubmitAttemptState,
  queueHostFillContinueJob,
  queueHostPrefillJob,
  scheduleHostSubmitJob,
  scheduleHostSubmitWhenFullyComplete,
} from "./host-submit";
import { shouldContinueHostFill, shouldSubmitOnHostContinue } from "./host-submit-policy";
import { kickHostSubmitWorkerIfEnabled } from "./host-submit-worker-kick";
import { isHostAutomationSchedulingEnabled, isServerHostSubmitEnabled } from "./host-submit-flags";
import { maybeSendPreDeadlineReviewForApplication } from "./pre-deadline-review-email";

/** Queue immediate prefill + schedule submit before deadline when automation is on. */
export async function syncHostAutomationForApplication(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  queuePrefill?: boolean;
}): Promise<void> {
  const prefs = parseWorkspacePreferences(input.actor.profile.preferences);
  if (!prefs.prepareAndSendIfSilent) return;

  if (!isHostAutomationSchedulingEnabled()) {
    logError("host_automation.schedule_disabled", {
      applicationId: input.applicationId,
      hint: "ENABLE_HOST_AUTOMATION_SCHEDULE is off — jobs will not be queued.",
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
      complete.reason !== "open_needs_you" &&
      complete.reason !== "already_submitted" &&
      complete.reason !== "submit_already_attempted"
    ) {
      logError("host_automation.no_deadline_submit_failed", {
        applicationId: input.applicationId,
        reason: complete.reason,
      });
    }
  } else if (
    !submit.ok &&
    submit.reason !== "already_submitted" &&
    submit.reason !== "submit_already_attempted"
  ) {
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

  // Playwright fallback only — extension claims jobs via /api/extension/host-submits/pending.
  if (isServerHostSubmitEnabled()) {
    await kickHostSubmitWorkerIfEnabled();
  }
}

/** After Need You edits, continue the page-loop when the current host page is ready. */
export async function tryContinueHostFillAfterNeedsYou(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
}): Promise<void> {
  const prefs = parseWorkspacePreferences(input.actor.profile.preferences);
  const { mappingBlocksHostPageContinue } = await import("./host-page-fill");
  const { dedupeFieldMappings } = await import("@/lib/field-mappings");

  const { data: mappings } = await input.supabase
    .from("field_mappings")
    .select("id, field_key, label, value, source, confidence, excluded_by_default, meta")
    .eq("application_id", input.applicationId)
    .eq("user_id", input.actor.userId);

  // Only host-page form gaps block continue — not Application deadline / kit-only empties.
  const blocking = dedupeFieldMappings(mappings ?? []).some((row) => mappingBlocksHostPageContinue(row));
  if (blocking) return;

  const { data: application } = await input.supabase
    .from("applications")
    .select("status, deadline_at")
    .eq("id", input.applicationId)
    .eq("user_id", input.actor.userId)
    .maybeSingle();

  const state = await loadHostSubmitAttemptState(input.supabase, input.applicationId, {
    status: application?.status ? String(application.status) : undefined,
    submitted_at: null,
  });
  if (!shouldContinueHostFill(state)) return;

  // Fill every reachable page ASAP from Need You / kit answers. Only click Submit once the
  // scheduled pre-deadline window is open (or no-deadline completion path below).
  const clickFinalSubmit = shouldSubmitOnHostContinue({
    prepareAndSendIfSilent: prefs.prepareAndSendIfSilent,
    state,
    deadlineAt: (application?.deadline_at as string | null) ?? null,
  });

  const continued = await queueHostFillContinueJob({
    ...input,
    clickFinalSubmit,
  });
  if (continued.ok) {
    if (isServerHostSubmitEnabled()) {
      await kickHostSubmitWorkerIfEnabled();
    }
    return;
  }

  if (!prefs.prepareAndSendIfSilent) return;

  const result = await scheduleHostSubmitWhenFullyComplete(input);
  if (result.ok && isServerHostSubmitEnabled()) {
    await kickHostSubmitWorkerIfEnabled();
  }
}

/** After Need You edits, queue host submit when every field is filled and no deadline is set. */
export async function tryNoDeadlineHostSubmitIfComplete(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
}): Promise<void> {
  await tryContinueHostFillAfterNeedsYou(input);
}
