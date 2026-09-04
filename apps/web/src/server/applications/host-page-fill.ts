/** Page-loop helpers: capture → headless memory → pause on required gaps → Next/Submit. */

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
 * Optional host fields never block Next/Submit.
 * Unanswered required fields (or unknown-required with a real value gap) do.
 */
export function mappingBlocksPageAdvance(row: {
  value?: string | null;
  confidence?: number | null;
  excluded_by_default?: boolean | null;
  meta?: unknown;
}): boolean {
  if (mappingMetaRequired(row.meta) === false) return false;
  const value = String(row.value ?? "").trim();
  const confidence = Number(row.confidence ?? 0);
  const empty = !value || confidence < 0.75 || Boolean(row.excluded_by_default);
  if (!empty) return false;
  if (mappingMetaRequired(row.meta) === true) return true;
  // Inventory rows (page_capture) with no required flag are optional until proven otherwise.
  return !Boolean(row.excluded_by_default);
}
