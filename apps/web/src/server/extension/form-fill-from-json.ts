import {
  FormFillPlanResponseSchema,
  FormPageCaptureSchema,
  type FormFieldResolution,
  type FormPageCapture,
  type FormPageHazards,
} from "@1apply/contracts";
import type { BatchFieldInput, BatchFieldResult } from "@1apply/contracts";
import {
  fieldSignals,
  stableBatchFieldId,
  toBatchFieldType,
  type DetectedField,
  type FieldMapping,
  type FieldType,
  FIELD_TYPES,
} from "@1apply/form-engine";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { recordAuditEvent } from "@/server/audit";

import { runBatchFillPlan } from "./batch-fill";

export function captureToBatchFields(capture: FormPageCapture): BatchFieldInput[] {
  return FormPageCaptureSchema.parse(capture).fields;
}

export function detectedFieldsToFormPageCapture(input: {
  fields: DetectedField[];
  origin: string;
  pageIndex?: number;
  hazards?: FormPageHazards;
}): FormPageCapture {
  const batchFields: BatchFieldInput[] = input.fields.map((field) => {
    const fieldId = stableBatchFieldId(field);
    return {
      fieldId,
      fieldKey: field.key,
      type: toBatchFieldType(field.type, field.inputType),
      label: field.label || field.name || field.key,
      name: field.name || undefined,
      options: field.options.length ? field.options : undefined,
      required: field.required,
      nearbyText: field.nearbyText || undefined,
      placeholder: field.placeholder || undefined,
      ariaLabel: field.ariaLabel || undefined,
    };
  });

  return FormPageCaptureSchema.parse({
    pageIndex: input.pageIndex ?? 0,
    origin: input.origin,
    hazards: input.hazards ?? {},
    fields: batchFields,
  });
}

export function hostFieldKeyMapFromCapture(capture: FormPageCapture): Record<string, string> {
  const map: Record<string, string> = {};
  for (const field of capture.fields) {
    if (field.fieldKey) map[field.fieldId] = field.fieldKey;
  }
  return map;
}

export function parseDetectedFields(raw: Array<Record<string, unknown>>): DetectedField[] {
  return raw.map((field) => {
    const type = (FIELD_TYPES as readonly string[]).includes(String(field.type ?? "text"))
      ? (String(field.type) as FieldType)
      : "text";
    const next = {
      key: String(field.key ?? ""),
      name: String(field.name ?? ""),
      id: String(field.id ?? ""),
      label: String(field.label ?? ""),
      placeholder: String(field.placeholder ?? ""),
      ariaLabel: String(field.ariaLabel ?? ""),
      nearbyText: String(field.nearbyText ?? ""),
      type,
      inputType: String(field.inputType ?? type),
      options: Array.isArray(field.options) ? field.options.map((item) => String(item)) : [],
      required: Boolean(field.required),
      autocomplete: String(field.autocomplete ?? ""),
      signals: String(field.signals ?? ""),
    };
    return { ...next, signals: next.signals || fieldSignals(next) };
  });
}

export function batchResultsToFormFillPlan(input: {
  page: FormPageCapture;
  fields: BatchFieldResult[];
  fillSessionId?: string | null;
}): FormFieldResolution[] {
  return input.fields.map((field) => ({
    fieldId: field.fieldId,
    status: field.status,
    value: field.value,
    evidenceIds: field.evidenceIds,
    documentVersionId: field.documentVersionId,
    resolution: field.resolution,
    reason: field.reason,
    applyMode: field.applyMode,
  }));
}

/** JSON in → memory + LLM → JSON out. Shared fill engine for server Playwright and optional manual extension fill. */
export async function fillFormPageFromJson(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  page: FormPageCapture;
  hostFieldKeyById?: Record<string, string>;
}) {
  const capture = FormPageCaptureSchema.parse(input.page);
  const hostFieldKeyById =
    input.hostFieldKeyById ??
    Object.fromEntries(capture.fields.map((field) => [field.fieldId, field.fieldKey || field.fieldId]));
  const result = await runBatchFillPlan({
    supabase: input.supabase,
    actor: input.actor,
    applicationId: input.applicationId,
    pageIndex: capture.pageIndex ?? 0,
    fields: captureToBatchFields(capture),
    origin: capture.origin,
    hazards: capture.hazards,
    hostFieldKeyById,
  });

  return FormFillPlanResponseSchema.parse({
    fillSessionId: result.fillSessionId,
    pageIndex: capture.pageIndex ?? 0,
    hazards: capture.hazards,
    fields: batchResultsToFormFillPlan({
      page: capture,
      fields: result.fields,
      fillSessionId: result.fillSessionId,
    }),
  });
}

/** Legacy fill-plan + chip UI — same JSON pipeline, host DOM keys in mappings. */
export async function fillLegacyFormPageFromJson(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  origin: string;
  fields: DetectedField[];
  hazards?: FormPageHazards;
  pageIndex?: number;
}): Promise<{
  fillSessionId: string;
  expiresAt: string;
  hazards: FormPageHazards;
  mappings: FieldMapping[];
}> {
  const origin = new URL(input.origin).origin;
  const hazards = {
    captcha: Boolean(input.hazards?.captcha),
    captchaVendor: input.hazards?.captchaVendor ?? null,
    captchaMessage: input.hazards?.captchaMessage ?? null,
    accountCreation: Boolean(input.hazards?.accountCreation),
    accountMessage: input.hazards?.accountMessage ?? null,
    unsupported: Boolean(input.hazards?.unsupported),
    unsupportedReason: input.hazards?.unsupportedReason ?? null,
    hasSubmitControl: input.hazards?.hasSubmitControl ?? null,
  };

  const capture = detectedFieldsToFormPageCapture({
    fields: input.fields,
    origin,
    pageIndex: input.pageIndex,
    hazards,
  });
  const hostFieldKeyById = hostFieldKeyMapFromCapture(capture);

  const result = await runBatchFillPlan({
    supabase: input.supabase,
    actor: input.actor,
    applicationId: input.applicationId,
    pageIndex: capture.pageIndex ?? 0,
    fields: captureToBatchFields(capture),
    origin,
    hazards,
    hostFieldKeyById,
  });

  if (!result.fillSessionId) {
    throw new Error("SAVE_FAILED");
  }

  await recordAuditEvent(input.supabase, "fill.plan_created", {
    applicationId: input.applicationId,
    fillSessionId: result.fillSessionId,
    fieldCount: result.mappings?.length ?? 0,
  });

  return {
    fillSessionId: result.fillSessionId,
    expiresAt: result.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    hazards,
    mappings: result.mappings ?? [],
  };
}
