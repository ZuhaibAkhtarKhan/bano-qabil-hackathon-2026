import { fieldSignals, mapField, type DetectedField } from "@1apply/form-engine";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { logError, logInfo } from "@/lib/log";
import { autoAttachKitAcrossOpenApplications } from "@/server/applications/attach-kit";
import { loadMemoryCatalog } from "@/server/extension/memory-catalog";
import { evaluateApplicationIntelligence } from "@/server/intelligence/evaluate";

const CLOSED = new Set(["submitted", "rejected", "withdrawn", "archived", "offer", "accepted"]);
const FILL_CONFIDENCE = 0.75;

function mappingToDetectedField(row: {
  field_key: string;
  label: string | null;
}): DetectedField {
  const label = String(row.label ?? "").trim() || String(row.field_key);
  const key = String(row.field_key);
  const field: Omit<DetectedField, "signals"> & { signals?: string } = {
    key,
    name: key,
    id: key,
    label,
    placeholder: "",
    ariaLabel: label,
    nearbyText: label,
    type: "text",
    inputType: "text",
    options: [],
    required: false,
    autocomplete: "",
  };
  return {
    ...field,
    signals: fieldSignals(field),
  };
}

/**
 * When Your kit changes, rematch open applications:
 * - attach matching documents
 * - fill empty / low-confidence field_mappings from the updated memory catalog
 * - always re-run Fit Index so Needs You Fit gaps (education/projects/skills) clear
 * Does not call revalidatePath — callers revalidate in the server action, and the
 * UI soft-refreshes via realtime on field_mappings / fit_evaluations.
 */
export async function refreshOpenApplicationsFromKit(
  supabase: SupabaseClient,
  actor: Actor,
): Promise<{ appsTouched: number; mappingsFilled: number; docsAttached: number }> {
  const docsAttached = await autoAttachKitAcrossOpenApplications(supabase, actor);

  const { data: applications } = await supabase
    .from("applications")
    .select("id, opportunity_id, status")
    .eq("user_id", actor.userId)
    .limit(40);

  let appsTouched = 0;
  let mappingsFilled = 0;
  const appsToEvaluate: Array<{ applicationId: string; opportunityId: string }> = [];
  const seenApps = new Set<string>();

  for (const application of applications ?? []) {
    if (CLOSED.has(String(application.status))) continue;
    const applicationId = String(application.id);
    const opportunityId = String(application.opportunity_id);

    if (!seenApps.has(applicationId)) {
      seenApps.add(applicationId);
      appsToEvaluate.push({ applicationId, opportunityId });
    }

    const { data: mappings } = await supabase
      .from("field_mappings")
      .select("id, field_key, label, value, confidence, excluded_by_default")
      .eq("user_id", actor.userId)
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(120);

    const pending = (mappings ?? []).filter((row) => {
      const value = String(row.value ?? "").trim();
      return !value || Number(row.confidence ?? 0) < FILL_CONFIDENCE || Boolean(row.excluded_by_default);
    });

    if (pending.length === 0) continue;

    const catalog = await loadMemoryCatalog(supabase, actor, applicationId);
    if (catalog.length === 0) continue;

    let filledHere = 0;
    const seenKeys = new Set<string>();

    for (const row of pending) {
      const fieldKey = String(row.field_key);
      if (seenKeys.has(fieldKey)) continue;
      seenKeys.add(fieldKey);

      const mapped = mapField(mappingToDetectedField(row), catalog);
      const proposed = String(mapped.proposedValue ?? "").trim();
      if (!proposed) continue;
      if (mapped.excludedByDefault) continue;
      if (mapped.confidence < FILL_CONFIDENCE) continue;
      // Don't overwrite a user-confirmed value with a weaker rematch.
      const existing = String(row.value ?? "").trim();
      if (existing && Number(row.confidence ?? 0) >= mapped.confidence) continue;

      const { error } = await supabase
        .from("field_mappings")
        .update({
          value: proposed.slice(0, 4000),
          source: `Your kit refresh · ${mapped.source}`.slice(0, 120),
          confidence: mapped.confidence,
          excluded_by_default: false,
          label: (mapped.label || row.label || fieldKey).slice(0, 180),
        })
        .eq("id", row.id)
        .eq("user_id", actor.userId);

      if (error) {
        logError("needs_you.kit_refresh_mapping_failed", {
          applicationId,
          fieldKey,
          message: error.message,
        });
        continue;
      }
      filledHere += 1;
    }

    // Clear answer missing_facts that the catalog can now satisfy.
    const { data: answers } = await supabase
      .from("application_answers")
      .select("id, missing_facts")
      .eq("user_id", actor.userId)
      .eq("application_id", applicationId);

    const catalogBlob = catalog
      .map((item) => `${item.path} ${item.value} ${item.aliases.join(" ")}`.toLowerCase())
      .join("\n");

    for (const answer of answers ?? []) {
      const missing = Array.isArray(answer.missing_facts)
        ? (answer.missing_facts as string[]).filter(Boolean)
        : [];
      if (missing.length === 0) continue;
      const remaining = missing.filter((fact) => {
        const token = fact.trim().toLowerCase();
        if (!token) return false;
        return !catalogBlob.includes(token) && !token.split(/\s+/).some((part) => part.length > 3 && catalogBlob.includes(part));
      });
      if (remaining.length === missing.length) continue;
      await supabase
        .from("application_answers")
        .update({ missing_facts: remaining })
        .eq("id", answer.id)
        .eq("user_id", actor.userId);
      filledHere += missing.length - remaining.length;
    }

    if (filledHere > 0) {
      appsTouched += 1;
      mappingsFilled += filledHere;
    }
  }

  for (const app of appsToEvaluate.slice(0, 12)) {
    try {
      await evaluateApplicationIntelligence(supabase, actor, app.applicationId, app.opportunityId);
    } catch (error) {
      logError("needs_you.kit_refresh_eval_failed", {
        applicationId: app.applicationId,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  logInfo("needs_you.kit_refresh_done", {
    userId: actor.userId,
    appsTouched,
    mappingsFilled,
    docsAttached,
    appsEvaluated: Math.min(appsToEvaluate.length, 12),
  });

  return { appsTouched, mappingsFilled, docsAttached };
}

/** Fire-and-forget so kit saves stay snappy; errors are logged only. */
export function scheduleRefreshOpenApplicationsFromKit(supabase: SupabaseClient, actor: Actor) {
  void refreshOpenApplicationsFromKit(supabase, actor).catch((error) => {
    logError("needs_you.kit_refresh_failed", {
      userId: actor.userId,
      message: error instanceof Error ? error.message : "unknown",
    });
  });
}
