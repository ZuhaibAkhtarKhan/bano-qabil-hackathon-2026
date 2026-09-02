import { computeDeadlineInfo, packetAnswerText } from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { logError } from "@/lib/log";
import type { NeedsYouInputType, NeedsYouItem } from "@/lib/needs-you";
import { generateAnswer } from "@/server/answers/generate";
import {
  applyValueToApplication,
  DEADLINE_AUTO_FILL_SOURCE,
} from "@/server/needs-you/apply-needs-you-value";
import { loadNeedsYouQueue } from "@/server/needs-you/queries";
import { recordApplicationEvent } from "@/services/platform";

const AUTO_FILL_INPUT_TYPES = new Set<NeedsYouInputType>([
  "text",
  "textarea",
  "email",
  "url",
  "tel",
  "number",
  "date",
  "datetime",
]);

const CLOSED_STATUSES = new Set(["submitted", "withdrawn", "rejected", "archived"]);

function deadlineForcesAutoFill(deadlineAt: string | null, deadlineTimezone: string | null): boolean {
  const deadline = computeDeadlineInfo(deadlineAt, deadlineTimezone);
  return (
    deadline.urgency === "imminent" ||
    deadline.urgency === "soon" ||
    deadline.urgency === "overdue"
  );
}

export function isAutoFillableNeedsYouTextItem(item: NeedsYouItem): boolean {
  if (!AUTO_FILL_INPUT_TYPES.has(item.inputType)) return false;
  if (item.kind === "document" || item.kind === "deadline") return false;
  if (item.payload.confirmEligible) return false;
  if (item.payload.currentValue?.trim()) return false;
  return true;
}

async function existingAnswerText(
  supabase: SupabaseClient,
  userId: string,
  answerId: string | null | undefined,
): Promise<string | null> {
  if (!answerId) return null;
  const { data: answer } = await supabase
    .from("application_answers")
    .select("approved_text, user_edited_text, original_ai_text, state")
    .eq("id", answerId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!answer) return null;
  const text = packetAnswerText({
    approvedText: (answer.approved_text as string | null) ?? null,
    userEditedText: (answer.user_edited_text as string | null) ?? null,
    originalAiText: (answer.original_ai_text as string | null) ?? null,
  });
  return text?.trim() || null;
}

async function draftNeedsYouItem(
  supabase: SupabaseClient,
  actor: Actor,
  applicationId: string,
  item: NeedsYouItem,
): Promise<string | null> {
  const questionId = item.payload.questionId?.trim() || null;
  const answerId = item.payload.answerId ?? null;

  if (questionId) {
    const existing = await existingAnswerText(supabase, actor.userId, answerId);
    if (existing) return existing;

    const result = await generateAnswer(supabase, actor, {
      applicationId,
      questionId,
      intent: "draft",
      tone: "formal",
    });
    const draft = String(result.text ?? "").trim();
    if (!draft || result.warnings?.includes("INSUFFICIENT_EVIDENCE")) return null;
    return draft;
  }

  const label = item.title.trim();
  if (!label) return null;
  const detail = item.detail?.trim() || "";
  const { generateGroundedAiDraft } = await import("@/server/extension/enrich-ai-answers");
  const result = await generateGroundedAiDraft({
    supabase,
    actor,
    applicationId,
    question: detail ? `${label}\n\nContext: ${detail}` : label,
  });
  const draft = String(result.draft ?? "").trim();
  return draft || null;
}

/**
 * Auto-generate unfilled Need You text fields when the application deadline is near.
 * Uses Application Memory for grounding; writes application-scoped values only.
 */
export async function autoFillNeedsYouTextBeforeDeadline(
  supabase: SupabaseClient,
  actor: Actor,
  applicationId: string,
  deadlineAt: string | null,
  deadlineTimezone: string | null,
  items?: NeedsYouItem[],
): Promise<number> {
  if (!deadlineForcesAutoFill(deadlineAt, deadlineTimezone)) return 0;

  const { data: application } = await supabase
    .from("applications")
    .select("id, status")
    .eq("id", applicationId)
    .eq("user_id", actor.userId)
    .maybeSingle();
  if (!application || CLOSED_STATUSES.has(String(application.status ?? ""))) return 0;

  const queueItems =
    items ??
    (await loadNeedsYouQueue({ polish: false })).items.filter(
      (item) => item.applicationId === applicationId,
    );
  const targets = queueItems.filter(isAutoFillableNeedsYouTextItem);
  if (targets.length === 0) return 0;

  let filled = 0;
  for (const item of targets) {
    try {
      const draft = await draftNeedsYouItem(supabase, actor, applicationId, item);
      if (!draft) continue;

      await applyValueToApplication({
        supabase,
        userId: actor.userId,
        applicationId,
        label: item.title,
        value: draft,
        mappingId: item.payload.mappingId ?? null,
        questionId: item.payload.questionId ?? null,
        answerId: item.payload.answerId ?? null,
        reviewItemId: item.payload.reviewItemId ?? null,
        scope: "application",
        sourceOverride: DEADLINE_AUTO_FILL_SOURCE,
      });
      filled += 1;
    } catch (err) {
      logError("needs_you.deadline_auto_fill_item_failed", {
        err,
        applicationId,
        itemId: item.id,
      });
    }
  }

  if (filled > 0) {
    await recordApplicationEvent(supabase, actor, applicationId, "needs_you.auto_filled", {
      count: filled,
    });
    await supabase
      .from("applications")
      .update({
        next_action: `${filled} Need You field${filled === 1 ? "" : "s"} auto-filled before the deadline`,
      })
      .eq("id", applicationId)
      .eq("user_id", actor.userId);
  }

  return filled;
}

/** Batch helper for automation sweeps — loads Need You once, fills per near-deadline app. */
export async function autoFillNeedsYouTextForNearDeadlineApplications(
  supabase: SupabaseClient,
  actor: Actor,
  applications: Array<{
    applicationId: string;
    deadlineAt: string | null;
    deadlineTimezone: string | null;
  }>,
): Promise<number> {
  const nearDeadline = applications.filter((row) =>
    deadlineForcesAutoFill(row.deadlineAt, row.deadlineTimezone),
  );
  if (nearDeadline.length === 0) return 0;

  const queue = await loadNeedsYouQueue({ polish: false });
  const itemsByApp = new Map<string, NeedsYouItem[]>();
  for (const item of queue.items) {
    const list = itemsByApp.get(item.applicationId) ?? [];
    list.push(item);
    itemsByApp.set(item.applicationId, list);
  }

  let total = 0;
  for (const row of nearDeadline) {
    total += await autoFillNeedsYouTextBeforeDeadline(
      supabase,
      actor,
      row.applicationId,
      row.deadlineAt,
      row.deadlineTimezone,
      itemsByApp.get(row.applicationId),
    );
  }
  return total;
}
