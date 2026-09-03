/** Rank/dedupe field_mappings so one host field_key keeps the best filled value. */

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
  if (source.includes("needs you")) score += 40;
  if (source.includes("memory") || source.includes("kit")) score += 25;
  if (source.includes("batch_fill") || source.includes("user (extension")) score += 15;
  if (source === "page_capture") score -= 50;
  return score;
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

export function mappingHasUsableFill(row: FieldMappingLike, minConfidence = 0.75): boolean {
  const value = String(row.value ?? "").trim();
  return Boolean(value) && Number(row.confidence ?? 0) >= minConfidence && !row.excluded_by_default;
}
