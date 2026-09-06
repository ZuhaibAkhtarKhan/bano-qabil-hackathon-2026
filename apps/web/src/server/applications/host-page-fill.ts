/** Page-loop helpers: capture → headless memory → pause on required gaps → Next/Submit. */

import { isCaptchaChallengeCopy, isFormBuilderChromeLabel, isMachineFieldToken } from "@1apply/form-engine";
import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeMappingIdentity } from "@/lib/field-mappings";
import { isNeedsYouSystemNoise } from "@/lib/needs-you";

export function planFillsField(plan: {
  status?: string | null;
  value?: string | null;
  documentVersionId?: string | null;
}): boolean {
  if (plan.status !== "filled") return false;
  return Boolean(String(plan.value ?? "").trim() || plan.documentVersionId);
}

/** Labels of required host fields that Application Memory / Need You cannot fill yet. */
export function requiredHostFieldsMissing(
  fields: Array<{ fieldId: string; required?: boolean; label: string }>,
  planFields: Array<{
    fieldId: string;
    status?: string | null;
    value?: string | null;
    documentVersionId?: string | null;
  }>,
): string[] {
  const byId = new Map(planFields.map((row) => [row.fieldId, row]));
  return fields
    .filter((field) => field.required)
    .filter((field) => !planFillsField(byId.get(field.fieldId) ?? {}))
    .map((field) => field.label.trim() || field.fieldId);
}

export function mappingMetaRequired(meta: unknown): boolean | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const required = (meta as { required?: unknown }).required;
  return typeof required === "boolean" ? required : null;
}

/**
 * Optional empty fields block Next until the applicant fills or explicitly skips them.
 * Skipped optionals (meta.skipped) and filled values do not block.
 */
export function mappingBlocksPageAdvance(row: {
  value?: string | null;
  confidence?: number | null;
  excluded_by_default?: boolean | null;
  meta?: unknown;
}): boolean {
  if (mappingMetaSkipped(row.meta)) return false;
  const value = String(row.value ?? "").trim();
  const confidence = Number(row.confidence ?? 0);
  const filled = Boolean(value) && confidence >= 0.75 && !row.excluded_by_default;
  if (filled) return false;
  return true;
}

export function mappingMetaSkipped(meta: unknown): boolean {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  return Boolean((meta as { skipped?: unknown }).skipped);
}

/**
 * True when this mapping came from (or was answered for) a live host form page.
 * Kit-only / ingest empties and platform Need You items (deadline, eligibility) must not
 * gate advancing to the next form page.
 */
export function mappingFromHostFormPage(row: {
  label?: string | null;
  field_key?: string | null;
  source?: string | null;
  meta?: unknown;
}): boolean {
  const label = String(row.label ?? "").trim();
  const key = String(row.field_key ?? "").trim();
  if (
    isCaptchaChallengeCopy(label) ||
    isCaptchaChallengeCopy(key) ||
    isNeedsYouSystemNoise(label) ||
    isNeedsYouSystemNoise(key) ||
    isFormBuilderChromeLabel(label) ||
    isFormBuilderChromeLabel(key)
  ) {
    return false;
  }
  if (isMachineFieldToken(label) && isMachineFieldToken(key)) return false;

  const source = String(row.source ?? "").toLowerCase();
  if (
    source === "page_capture" ||
    source.includes("batch_fill") ||
    source.includes("needs you") ||
    source.includes("user (extension") ||
    source.includes("application tab edit")
  ) {
    return true;
  }
  // Page inventory always stamps meta.required on host fields.
  return mappingMetaRequired(row.meta) !== null;
}

/**
 * Gate for queueing host_page_loop after Need You edits.
 * Only unanswered host-page fields (or unskipped optionals) block; Application deadline
 * and other non-page Need You items do not.
 */
export function mappingBlocksHostPageContinue(row: {
  label?: string | null;
  field_key?: string | null;
  value?: string | null;
  confidence?: number | null;
  excluded_by_default?: boolean | null;
  source?: string | null;
  meta?: unknown;
}): boolean {
  if (!mappingFromHostFormPage(row)) return false;
  return mappingBlocksPageAdvance(row);
}

const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Real file uploads are skipped by the text/choice fillers.
 * Questions misclassified as `file` but holding Need You text must still type.
 */
export function isHostFileUploadEntry(entry: {
  type?: string | null;
  documentVersionId?: string | null;
  value?: string | null;
}): boolean {
  if (entry.documentVersionId) return true;
  if (entry.type !== "file") return false;
  const value = String(entry.value ?? "").trim();
  return !value || VERSION_ID.test(value);
}

/**
 * When the extension cannot click a saved Need You / memory answer onto the host page,
 * reopen those mappings in Need You (keep the value, mark pending) so the loop is not stuck.
 */
export async function reopenMappingsForHostApplyFailures(input: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
  labels: string[];
}): Promise<number> {
  const wanted = [
    ...new Set(
      input.labels
        .map((label) => normalizeMappingIdentity(label))
        .filter((label) => label.length >= 2),
    ),
  ];
  if (!wanted.length) return 0;

  const { data: rows } = await input.supabase
    .from("field_mappings")
    .select("id, label, field_key, value, meta, excluded_by_default, confidence")
    .eq("application_id", input.applicationId)
    .eq("user_id", input.userId);

  let updated = 0;
  for (const row of rows ?? []) {
    const label = normalizeMappingIdentity(String(row.label ?? ""));
    const key = normalizeMappingIdentity(String(row.field_key ?? ""));
    const hit = wanted.some(
      (item) =>
        label === item ||
        key === item ||
        (label.length >= 4 && (label.includes(item) || item.includes(label))) ||
        (key.length >= 4 && (key.includes(item) || item.includes(key))),
    );
    if (!hit) continue;
    if (!String(row.value ?? "").trim() && row.excluded_by_default) continue;

    const priorMeta =
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : {};
    if (priorMeta.skipped) continue;

    const { error } = await input.supabase
      .from("field_mappings")
      .update({
        excluded_by_default: true,
        confidence: Math.min(Number(row.confidence ?? 0.9), 0.7),
        meta: {
          ...priorMeta,
          hostApplyFailed: true,
        },
      })
      .eq("id", row.id)
      .eq("user_id", input.userId);
    if (!error) updated += 1;
  }
  return updated;
}
