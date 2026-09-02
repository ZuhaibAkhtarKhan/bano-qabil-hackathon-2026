import { computeDeadlineInfo } from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { recordApplicationEvent } from "@/services/platform";

const AUTO_CONFIRM_STATES = new Set(["unclear", "needs_confirmation"]);

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
