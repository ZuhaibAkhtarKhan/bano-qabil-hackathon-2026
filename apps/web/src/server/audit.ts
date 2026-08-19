import type { SupabaseClient } from "@supabase/supabase-js";

const BLOCKED_KEYS = /password|secret|token|authorization|cookie|api[-_]?key|ssn|refresh|access_token|pageText|prompt|answer/i;

function scrub(value: unknown, key?: string): unknown {
  if (key && BLOCKED_KEYS.test(key)) return undefined;
  if (Array.isArray(value)) return value.map((item) => scrub(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([childKey, childValue]) => [childKey, scrub(childValue, childKey)])
        .filter(([, childValue]) => childValue !== undefined),
    );
  }
  return value;
}

export async function recordAuditEvent(
  supabase: SupabaseClient,
  eventName: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabase.rpc("record_audit_event", {
      p_event_name: eventName,
      p_metadata: scrub(metadata) ?? {},
    });
  } catch {
    // Migration 20260819160000 must be applied before events persist.
  }
}
