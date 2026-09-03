import type { SupabaseClient } from "@supabase/supabase-js";

export const DEADLINE_AUTO_FILL_SOURCE = "Deadline auto-fill (AI)";

export async function applyValueToApplication(input: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
  label: string;
  value: string;
  mappingId?: string | null;
  questionId?: string | null;
  answerId?: string | null;
  reviewItemId?: string | null;
  scope: "memory" | "application";
  sourceOverride?: string | null;
}) {
  const value = input.value.trim();
  if (!value) return;
  const source =
    input.sourceOverride?.trim() ||
    (input.scope === "memory" ? "Application Memory (Needs You)" : "Needs You (this application only)");

  if (input.reviewItemId) {
    await input.supabase
      .from("review_items")
      .update({ resolved: true })
      .eq("id", input.reviewItemId)
      .eq("user_id", input.userId);
  }

  if (input.mappingId) {
    const { data: target } = await input.supabase
      .from("field_mappings")
      .select("id, field_key")
      .eq("id", input.mappingId)
      .eq("user_id", input.userId)
      .maybeSingle();

    await input.supabase
      .from("field_mappings")
      .update({
        value: value.slice(0, 4000),
        source,
        confidence: 1,
        excluded_by_default: false,
      })
      .eq("id", input.mappingId)
      .eq("user_id", input.userId);

    // Collapse sibling rows with the same host field_key (empty page_capture leftovers).
    if (target?.field_key) {
      const { data: siblings } = await input.supabase
        .from("field_mappings")
        .select("id")
        .eq("application_id", input.applicationId)
        .eq("user_id", input.userId)
        .eq("field_key", String(target.field_key))
        .neq("id", input.mappingId);
      const siblingIds = (siblings ?? []).map((row) => String(row.id));
      if (siblingIds.length) {
        await input.supabase
          .from("field_mappings")
          .delete()
          .eq("user_id", input.userId)
          .in("id", siblingIds);
      }
    }
  } else if (!input.questionId) {
    const fieldKey = `needs_you:${input.label.trim().toLowerCase().slice(0, 80).replace(/\s+/g, "_")}`;
    const { data: existing } = await input.supabase
      .from("field_mappings")
      .select("id")
      .eq("application_id", input.applicationId)
      .eq("user_id", input.userId)
      .eq("field_key", fieldKey)
      .maybeSingle();

    if (existing?.id) {
      await input.supabase
        .from("field_mappings")
        .update({
          value: value.slice(0, 4000),
          label: input.label.slice(0, 200),
          source,
          confidence: 1,
          excluded_by_default: false,
        })
        .eq("id", existing.id);
    } else {
      await input.supabase.from("field_mappings").insert({
        user_id: input.userId,
        application_id: input.applicationId,
        field_key: fieldKey,
        label: input.label.slice(0, 200) || "Application fact",
        value: value.slice(0, 4000),
        source,
        confidence: 1,
        excluded_by_default: false,
        sensitive: false,
      });
    }
  }

  if (input.questionId) {
    if (input.answerId) {
      await input.supabase
        .from("application_answers")
        .update({
          user_edited_text: value,
          approved_text: value,
          state: "approved",
          missing_facts: [],
          warnings: [],
        })
        .eq("id", input.answerId)
        .eq("user_id", input.userId);
    } else {
      await input.supabase.from("application_answers").insert({
        user_id: input.userId,
        application_id: input.applicationId,
        question_id: input.questionId,
        user_edited_text: value,
        approved_text: value,
        state: "approved",
        missing_facts: [],
        warnings: [],
        evidence_ids: [],
        claim_flags: [],
        grounding_score: 0,
        generation_count: 0,
        model: null,
      });
    }
  }
}
