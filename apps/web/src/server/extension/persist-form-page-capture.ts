import type { FormPageCapture } from "@1apply/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { persistableFormChoiceOptions } from "@/lib/needs-you-field-kinds";

/** Persist first-page (or any page) form inventory JSON for later fill + Need You. */
export async function persistFormPageCapture(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
  opportunityId: string,
  capture: FormPageCapture,
): Promise<number> {
  const pageIndex = capture.pageIndex ?? 0;
  const fields = capture.fields.slice(0, 80);
  if (!fields.length) return 0;

  const { data: opportunity } = await supabase
    .from("opportunities")
    .select("metadata")
    .eq("id", opportunityId)
    .eq("user_id", userId)
    .maybeSingle();

  const prior = (opportunity?.metadata && typeof opportunity.metadata === "object"
    ? opportunity.metadata
    : {}) as Record<string, unknown>;
  const formPages = Array.isArray(prior.formPages) ? [...prior.formPages] : [];
  const nextPages = formPages.filter(
    (page) => !(page && typeof page === "object" && (page as { pageIndex?: number }).pageIndex === pageIndex),
  );
  nextPages.push({
    pageIndex,
    capturedAt: new Date().toISOString(),
    pageUrl: capture.pageUrl ?? null,
    pageTitle: capture.pageTitle ?? null,
    origin: capture.origin ?? null,
    hazards: capture.hazards ?? {},
    fields,
  });
  nextPages.sort((a, b) => {
    const left = a && typeof a === "object" ? Number((a as { pageIndex?: number }).pageIndex ?? 0) : 0;
    const right = b && typeof b === "object" ? Number((b as { pageIndex?: number }).pageIndex ?? 0) : 0;
    return left - right;
  });

  await supabase
    .from("opportunities")
    .update({ metadata: { ...prior, formPages: nextPages } })
    .eq("id", opportunityId)
    .eq("user_id", userId);

  const rows = fields.map((field) => {
    const choiceValues = persistableFormChoiceOptions({
      fieldType: field.type === "contenteditable" ? "textarea" : field.type,
      hostOptions: field.options ?? [],
      mappingOptionValues: field.options ?? [],
    });
    return {
      field_key: String(field.fieldId).slice(0, 180),
      label: field.label.slice(0, 180),
      value: String(field.currentValue ?? "").slice(0, 4000),
      source: "page_capture",
      confidence: 0.1,
      excluded_by_default: true,
      sensitive: false,
      field_type: field.type,
      options: choiceValues,
      meta: {
        pageIndex,
        fieldKey: field.fieldKey ?? null,
        required: Boolean(field.required),
        nearbyText: field.nearbyText ?? null,
        placeholder: field.placeholder ?? null,
        ariaLabel: field.ariaLabel ?? null,
        maxLength: field.maxLength ?? null,
        name: field.name ?? null,
      },
      fill_session_id: null,
    };
  });

  if (rows.length) {
    const { upsertApplicationFieldMappings } = await import("@/server/applications/field-mappings-upsert");
    await upsertApplicationFieldMappings({
      supabase,
      userId,
      applicationId,
      rows,
    });
  }

  return rows.length;
}
