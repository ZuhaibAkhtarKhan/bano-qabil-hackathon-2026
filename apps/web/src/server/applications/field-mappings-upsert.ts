import type { SupabaseClient } from "@supabase/supabase-js";

import { dedupeFieldMappings, fieldMappingFillScore, shouldPreserveUserFieldMapping } from "@/lib/field-mappings";

export type FieldMappingWriteRow = {
  field_key: string;
  label: string;
  value: string;
  source: string;
  confidence: number;
  excluded_by_default: boolean;
  sensitive?: boolean;
  field_type?: string | null;
  options?: unknown;
  meta?: Record<string, unknown>;
  fill_session_id?: string | null;
};

/**
 * Upsert mappings by field_key: keep the better of existing vs incoming, delete duplicate keys.
 * Empty page_capture never overwrites a filled Need You / memory value.
 */
export async function upsertApplicationFieldMappings(input: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
  rows: FieldMappingWriteRow[];
}): Promise<number> {
  const { supabase, userId, applicationId, rows } = input;
  if (!rows.length) return 0;

  const keys = [...new Set(rows.map((row) => row.field_key.slice(0, 180)).filter(Boolean))];
  const { data: existing } = await supabase
    .from("field_mappings")
    .select(
      "id, field_key, label, value, source, confidence, excluded_by_default, sensitive, field_type, options, meta, created_at",
    )
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .in("field_key", keys);

  const existingByKey = new Map<string, Array<NonNullable<typeof existing>[number]>>();
  for (const row of existing ?? []) {
    const key = String(row.field_key);
    const list = existingByKey.get(key) ?? [];
    list.push(row);
    existingByKey.set(key, list);
  }

  let written = 0;
  const deleteIds = new Set<string>();

  for (const incoming of rows) {
    const key = incoming.field_key.slice(0, 180);
    const priors = existingByKey.get(key) ?? [];
    const bestPrior = priors.length
      ? priors.reduce((a, b) => (fieldMappingFillScore(b) > fieldMappingFillScore(a) ? b : a))
      : null;

    // Do not let page recapture / empty batch_fill clobber a filled Need You answer.
    if (bestPrior && shouldPreserveUserFieldMapping(bestPrior, incoming)) {
      for (const prior of priors) {
        if (prior.id !== bestPrior.id) deleteIds.add(String(prior.id));
      }
      continue;
    }

    const keepId = bestPrior?.id ? String(bestPrior.id) : null;
    const payload = {
      label: incoming.label.slice(0, 180),
      value: String(incoming.value ?? "").slice(0, 4000),
      source: incoming.source.slice(0, 120),
      confidence: incoming.confidence,
      excluded_by_default: incoming.excluded_by_default,
      sensitive: Boolean(incoming.sensitive),
      ...(incoming.field_type ? { field_type: incoming.field_type } : {}),
      ...(incoming.options !== undefined ? { options: incoming.options } : {}),
      ...(incoming.meta ? { meta: incoming.meta } : {}),
      ...(incoming.fill_session_id !== undefined ? { fill_session_id: incoming.fill_session_id } : {}),
    };

    if (keepId) {
      await supabase.from("field_mappings").update(payload).eq("id", keepId).eq("user_id", userId);
      for (const prior of priors) {
        if (String(prior.id) !== keepId) deleteIds.add(String(prior.id));
      }
    } else {
      await supabase.from("field_mappings").insert({
        user_id: userId,
        application_id: applicationId,
        field_key: key,
        ...payload,
      });
    }
    written += 1;
  }

  if (deleteIds.size > 0) {
    await supabase
      .from("field_mappings")
      .delete()
      .eq("user_id", userId)
      .eq("application_id", applicationId)
      .in("id", [...deleteIds]);
  }

  // Also collapse Email * / Email style label duplicates across different keys.
  await collapseDuplicateFieldMappings({ supabase, userId, applicationId });

  return written;
}

/** Collapse duplicate field_keys and duplicate labels (filled wins). */
export async function collapseDuplicateFieldMappings(input: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
}): Promise<number> {
  const { supabase, userId, applicationId } = input;
  const { data } = await supabase
    .from("field_mappings")
    .select("id, field_key, label, value, source, confidence, excluded_by_default, created_at")
    .eq("application_id", applicationId)
    .eq("user_id", userId);

  if (!data?.length) return 0;

  const winners = new Set(dedupeFieldMappings(data).map((row) => String(row.id)));
  const losers = data.map((row) => String(row.id)).filter((id) => !winners.has(id));
  if (!losers.length) return 0;

  await supabase
    .from("field_mappings")
    .delete()
    .eq("user_id", userId)
    .eq("application_id", applicationId)
    .in("id", losers);

  return losers.length;
}
