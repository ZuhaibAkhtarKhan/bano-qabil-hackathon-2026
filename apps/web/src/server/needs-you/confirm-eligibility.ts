import {
  computeDeadlineInfo,
  expandAffirmativeAuthorizationValue,
  isAffirmativeEligibilityAnswer,
  isNegativeEligibilityAnswer,
  isWorkAuthorizationRequirement,
  workAuthorizationMeetsRequirement,
} from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { recordApplicationEvent } from "@/services/platform";

const AUTO_CONFIRM_STATES = new Set(["unclear", "needs_confirmation"]);
const APPLICANT_CONFIRMABLE_STATES = new Set(["unclear", "needs_confirmation", "partial"]);

export async function markEligibilityAckOnly(
  supabase: SupabaseClient,
  userId: string,
  eligibilityIds: string[],
) {
  const ids = [...new Set(eligibilityIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return;
  await supabase
    .from("eligibility_results")
    .update({ ack_only: true })
    .eq("user_id", userId)
    .is("user_confirmed_at", null)
    .in("id", ids);
}

export async function resolveEligibilityForConfirm(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
  eligibilityId: string,
  requirementId?: string | null,
) {
  const select =
    "id, application_id, requirement_id, ack_only, state, user_confirmed_at, requirement_text";

  const { data: byId } = await supabase
    .from("eligibility_results")
    .select(select)
    .eq("id", eligibilityId)
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (byId) return byId;

  const reqId = String(requirementId ?? "").trim();
  if (!reqId) return null;

  const { data: byRequirement } = await supabase
    .from("eligibility_results")
    .select(select)
    .eq("application_id", applicationId)
    .eq("requirement_id", reqId)
    .eq("user_id", userId)
    .is("user_confirmed_at", null)
    .maybeSingle();

  return byRequirement;
}

export function canApplicantConfirmEligibility(row: {
  ack_only?: boolean | null;
  state?: string | null;
  user_confirmed_at?: string | null;
}) {
  if (row.user_confirmed_at) return true;
  if (row.ack_only) return true;
  return APPLICANT_CONFIRMABLE_STATES.has(String(row.state ?? ""));
}

function deadlineForcesConfirm(deadlineAt: string | null, timezone: string | null): boolean {
  const deadline = computeDeadlineInfo(deadlineAt, timezone);
  return (
    deadline.urgency === "imminent" ||
    deadline.urgency === "soon" ||
    deadline.urgency === "overdue"
  );
}

export async function confirmEligibilityResult(
  supabase: SupabaseClient,
  actor: Actor,
  eligibilityResultId: string,
  options: { auto?: boolean } = {},
): Promise<boolean> {
  const { data: row } = await supabase
    .from("eligibility_results")
    .select("id, application_id, requirement_text, user_confirmed_at, state")
    .eq("id", eligibilityResultId)
    .eq("user_id", actor.userId)
    .maybeSingle();

  if (!row || row.user_confirmed_at) return false;

  const requirement = String(row.requirement_text ?? "this requirement").trim();
  const confirmedAt = new Date().toISOString();
  const explanation = options.auto
    ? `Applicant eligibility was auto-confirmed before the deadline for: ${requirement}.`
    : `Applicant confirmed they meet this requirement: ${requirement}.`;

  const { error } = await supabase
    .from("eligibility_results")
    .update({
      state: "met",
      needs_confirmation: false,
      user_confirmed_at: confirmedAt,
      auto_confirmed: options.auto === true,
      ack_only: true,
      explanation,
    })
    .eq("id", eligibilityResultId)
    .eq("user_id", actor.userId);

  if (error) return false;

  await recordApplicationEvent(
    supabase,
    actor,
    String(row.application_id),
    options.auto ? "eligibility.auto_confirmed" : "eligibility.confirmed",
    { eligibilityResultId, requirement },
  );

  return true;
}

async function resolveMatchingEligibilityReviews(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
  requirementText: string,
) {
  const { data: reviews } = await supabase
    .from("review_items")
    .select("id, prompt")
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .eq("kind", "eligibility")
    .eq("resolved", false);
  const req = requirementText.toLowerCase();
  const workAuth = isWorkAuthorizationRequirement(requirementText);
  for (const row of reviews ?? []) {
    const prompt = String(row.prompt ?? "").toLowerCase();
    const matches =
      (req && prompt.includes(req.slice(0, 48))) ||
      (workAuth && isWorkAuthorizationRequirement(prompt));
    if (!matches) continue;
    await supabase.from("review_items").update({ resolved: true }).eq("id", row.id).eq("user_id", userId);
  }
}

async function persistWorkAuthorizationFromRequirement(
  supabase: SupabaseClient,
  userId: string,
  requirementText: string,
  value: string,
) {
  if (!isWorkAuthorizationRequirement(requirementText) && !isWorkAuthorizationRequirement(value)) return;
  const next = expandAffirmativeAuthorizationValue(value || "Yes", requirementText);
  if (!next) return;
  const { data: profile } = await supabase
    .from("profiles")
    .select("work_authorization")
    .eq("id", userId)
    .maybeSingle();
  const current = String(profile?.work_authorization ?? "").trim();
  if (current && !isAffirmativeEligibilityAnswer(current) && current.length > next.length) return;
  if (current === next) return;
  await supabase.from("profiles").update({ work_authorization: next.slice(0, 400) }).eq("id", userId);
}

/**
 * Lock an eligibility gap after the applicant answers it so fill/analyze cannot reopen it.
 * Empty value (confirm button) is treated as Yes.
 */
export async function settleEligibilityFromApplicantAnswer(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  eligibilityId: string;
  requirementId?: string | null;
  value?: string | null;
}): Promise<boolean> {
  const row = await resolveEligibilityForConfirm(
    input.supabase,
    input.actor.userId,
    input.applicationId,
    input.eligibilityId,
    input.requirementId,
  );
  if (!row) return false;

  const requirement = String(row.requirement_text ?? "").trim();
  const value = String(input.value ?? "").trim();
  const implicitYes = !value;
  const verdict = value ? workAuthorizationMeetsRequirement(requirement || value, value) : "met";

  if (row.user_confirmed_at) {
    await resolveMatchingEligibilityReviews(input.supabase, input.actor.userId, input.applicationId, requirement);
    return true;
  }

  if (implicitYes || isAffirmativeEligibilityAnswer(value) || verdict === "met") {
    if (!row.ack_only) {
      await markEligibilityAckOnly(input.supabase, input.actor.userId, [String(row.id)]);
    }
    const ok = await confirmEligibilityResult(input.supabase, input.actor, String(row.id));
    if (ok) {
      await persistWorkAuthorizationFromRequirement(
        input.supabase,
        input.actor.userId,
        requirement,
        value || "Yes",
      );
      await resolveMatchingEligibilityReviews(input.supabase, input.actor.userId, input.applicationId, requirement);
    }
    return ok;
  }

  if (isNegativeEligibilityAnswer(value) || verdict === "not_met") {
    const confirmedAt = new Date().toISOString();
    const { error } = await input.supabase
      .from("eligibility_results")
      .update({
        state: "not_met",
        needs_confirmation: false,
        user_confirmed_at: confirmedAt,
        ack_only: true,
        explanation: `Applicant indicated they do not meet this requirement: ${requirement || value}`,
      })
      .eq("id", row.id)
      .eq("user_id", input.actor.userId);
    if (error) return false;
    await resolveMatchingEligibilityReviews(input.supabase, input.actor.userId, input.applicationId, requirement);
    await recordApplicationEvent(
      input.supabase,
      input.actor,
      input.applicationId,
      "eligibility.confirmed",
      { eligibilityResultId: row.id, requirement, state: "not_met" },
    );
    return true;
  }

  return false;
}

/** Auto-confirm ack-only eligibility gaps when the application deadline is near. */
export async function autoConfirmAckOnlyEligibilityBeforeDeadline(
  supabase: SupabaseClient,
  actor: Actor,
  applicationId: string,
  deadlineAt: string | null,
  deadlineTimezone: string | null,
): Promise<number> {
  if (!deadlineForcesConfirm(deadlineAt, deadlineTimezone)) return 0;

  const { data: rows } = await supabase
    .from("eligibility_results")
    .select("id, state")
    .eq("application_id", applicationId)
    .eq("user_id", actor.userId)
    .eq("ack_only", true)
    .is("user_confirmed_at", null);

  let confirmed = 0;
  for (const row of rows ?? []) {
    if (!AUTO_CONFIRM_STATES.has(String(row.state ?? ""))) continue;
    const ok = await confirmEligibilityResult(supabase, actor, String(row.id), { auto: true });
    if (ok) confirmed += 1;
  }
  return confirmed;
}
