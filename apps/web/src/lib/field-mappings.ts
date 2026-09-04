/** Rank/dedupe field_mappings so one host question keeps the best filled value. */

export type FieldMappingLike = {
  id?: string;
  field_key: string;
  label?: string | null;
  value?: string | null;
  source?: string | null;
  confidence?: number | null;
  excluded_by_default?: boolean | null;
  created_at?: string | null;
  field_type?: string | null;
};

/**
 * Collapse "Email *", "Email", "Comments CommentsYour answer" into one identity
 * so Autofill UI and host submit don't keep duplicate rows / miss saved values.
 */
export function normalizeMappingIdentity(text: string): string {
  let next = String(text ?? "")
    .toLowerCase()
    // Google Forms often concatenates "Comments" + "Your answer" → "CommentsYour answer"
    .replace(/your\s*answer/gi, " ")
    .replace(/\bthis is a required question\b/gi, " ")
    .replace(/[*＊]+/g, " ")
    .replace(/[：:]+/g, " ")
    .replace(/[_/\\|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // "comments comments" → "comments"
  next = next.replace(/\b(\w+)(?:\s+\1)+\b/g, "$1");
  return next;
}

/** Higher = better for autofill / Need You / host submit. */
export function fieldMappingFillScore(row: FieldMappingLike): number {
  const value = String(row.value ?? "").trim();
  const confidence = Number(row.confidence ?? 0);
  const excluded = Boolean(row.excluded_by_default);
  const source = String(row.source ?? "").toLowerCase();

  let score = 0;
  if (value) score += 1000;
  score += Math.round(Math.min(1, Math.max(0, confidence)) * 100);
  if (!excluded) score += 50;
  if (source.includes("needs you") || source.includes("application tab edit")) score += 40;
  if (source.includes("memory") || source.includes("kit")) score += 25;
  if (source.includes("batch_fill") || source.includes("user (extension")) score += 15;
  if (source === "page_capture") score -= 50;
  // Prefer shorter/cleaner labels when scores tie later.
  const labelLen = String(row.label ?? "").trim().length;
  if (labelLen > 0 && labelLen < 40) score += 5;
  return score;
}

function mappingIdentity(row: FieldMappingLike): string {
  const fromLabel = normalizeMappingIdentity(String(row.label ?? ""));
  if (fromLabel.length >= 2) return `label:${fromLabel}`;
  const fromKey = normalizeMappingIdentity(String(row.field_key ?? "").replace(/^f_[a-f0-9]+$/i, ""));
  if (fromKey.length >= 2) return `key:${fromKey}`;
  return `key:${String(row.field_key ?? "").trim().toLowerCase()}`;
}

/** Keep one row per field_key — filled / high-confidence / Need You wins over empty page_capture. */
export function dedupeFieldMappingsByKey<T extends FieldMappingLike>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const key = String(row.field_key ?? "").trim();
    if (!key) continue;
    const prev = best.get(key);
    if (!prev || fieldMappingFillScore(row) > fieldMappingFillScore(prev)) {
      best.set(key, row);
    }
  }
  return [...best.values()];
}

/**
 * Keep one row per logical question (normalized label), then per field_key.
 * Use for Autofill UI and collapse jobs — Email * vs Email must not both show.
 */
export function dedupeFieldMappings<T extends FieldMappingLike>(rows: T[]): T[] {
  const byIdentity = new Map<string, T>();
  for (const row of rows) {
    const identity = mappingIdentity(row);
    if (!identity || identity === "key:") continue;
    const prev = byIdentity.get(identity);
    if (!prev || fieldMappingFillScore(row) > fieldMappingFillScore(prev)) {
      byIdentity.set(identity, row);
    }
  }
  // Still collapse exact field_key dupes among winners.
  return dedupeFieldMappingsByKey([...byIdentity.values()]);
}

/** @deprecated Prefer dedupeFieldMappings — kept for call sites that only need key collapse. */
export const dedupeFieldMappingsByLabel = dedupeFieldMappings;

export function mappingHasUsableFill(row: FieldMappingLike, minConfidence = 0.75): boolean {
  const value = String(row.value ?? "").trim();
  return Boolean(value) && Number(row.confidence ?? 0) >= minConfidence && !row.excluded_by_default;
}

/** User-saved answers must survive kit rematch (including Fill just for this application). */
export function isUserConfirmedFieldMappingSource(source: string | null | undefined): boolean {
  const value = String(source ?? "").toLowerCase();
  return (
    value.includes("needs you") ||
    value.includes("this application only") ||
    value.includes("application tab edit") ||
    value.includes("user (extension")
  );
}

/** Find the best stored mapping for a live host field label/key. */
export function matchStoredMappingForHostField<T extends FieldMappingLike>(
  stored: T[],
  host: { fieldKey?: string | null; fieldId?: string | null; label?: string | null },
): T | null {
  const hostKey = String(host.fieldKey ?? "").trim();
  const hostId = String(host.fieldId ?? "").trim();
  const hostLabel = normalizeMappingIdentity(String(host.label ?? ""));

  let best: T | null = null;
  let bestScore = -1;

  for (const row of stored) {
    const key = String(row.field_key ?? "").trim();
    const label = normalizeMappingIdentity(String(row.label ?? ""));
    const exactKey = Boolean(hostKey && key === hostKey) || Boolean(hostId && key === hostId);
    const exactLabel = Boolean(hostLabel && label && hostLabel === label);
    const looseLabel =
      Boolean(hostLabel && label) && (hostLabel.includes(label) || label.includes(hostLabel)) && hostLabel.length >= 3;
    if (!exactKey && !exactLabel && !looseLabel) continue;
    let score = fieldMappingFillScore(row);
    if (exactKey) score += 80;
    if (exactLabel) score += 60;
    if (looseLabel && !exactLabel) score += 20;
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}
