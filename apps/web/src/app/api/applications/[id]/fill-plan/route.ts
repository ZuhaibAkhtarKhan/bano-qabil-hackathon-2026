import { createApiEnvelopeSchema, uuidSchema } from "@1apply/contracts";
import { fieldSignals, mapFields, type DetectedField, type FieldType, FIELD_TYPES } from "@1apply/form-engine";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";
import { extensionPreflight, withExtensionCors } from "@/server/auth/extension-cors";
import { loadMemoryCatalog } from "@/server/extension/memory-catalog";
import { recordAuditEvent } from "@/server/audit";

const fieldSchema = z.object({
  key: z.string(),
  name: z.string().default(""),
  id: z.string().default(""),
  label: z.string().default(""),
  placeholder: z.string().default(""),
  ariaLabel: z.string().default(""),
  nearbyText: z.string().default(""),
  type: z.string().default("text"),
  inputType: z.string().default("text"),
  options: z.array(z.string()).default([]),
  required: z.boolean().default(false),
  autocomplete: z.string().default(""),
  signals: z.string().optional(),
});

const bodySchema = z.object({
  origin: z.string().url(),
  fields: z.array(fieldSchema).max(80),
});

const envelope = createApiEnvelopeSchema(
  z.object({
    fillSessionId: uuidSchema,
    expiresAt: z.string(),
    hazards: z.unknown(),
    mappings: z.array(
      z.object({
        fieldKey: z.string(),
        label: z.string(),
        memoryPath: z.string(),
        source: z.string(),
        confidence: z.number(),
        proposedValue: z.string(),
        approvalState: z.string(),
        sensitive: z.boolean(),
        excludedByDefault: z.boolean(),
        reason: z.string(),
        fieldType: z.string(),
      }),
    ),
  }),
);

export function OPTIONS(request: Request) {
  return extensionPreflight(request);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const { id: applicationId } = await context.params;
  const parsedId = uuidSchema.safeParse(applicationId);
  if (!parsedId.success) {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({ data: null, error: { code: "VALIDATION", message: "Invalid application." }, requestId }),
        { status: 400 },
      ),
    );
  }

  let session;
  try {
    session = await requireApiSession(request);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return withExtensionCors(request, apiAuthResponse(error, envelope, requestId));
    }
    throw error;
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({ data: null, error: { code: "INVALID_JSON", message: "Request body must be JSON." }, requestId }),
        { status: 400 },
      ),
    );
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({ data: null, error: { code: "VALIDATION", message: "Invalid fill-plan payload." }, requestId }),
        { status: 422 },
      ),
    );
  }

  const { data: application } = await session.supabase
    .from("applications")
    .select("id")
    .eq("id", parsedId.data)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!application) {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({ data: null, error: { code: "NOT_FOUND", message: "Application not found." }, requestId }),
        { status: 404 },
      ),
    );
  }

  const origin = new URL(parsed.data.origin).origin;
  const fields: DetectedField[] = parsed.data.fields.map((field) => {
    const type = (FIELD_TYPES as readonly string[]).includes(field.type) ? (field.type as FieldType) : "text";
    const next = { ...field, type };
    return {
      ...next,
      signals: field.signals || fieldSignals(next),
    };
  });
  const catalog = await loadMemoryCatalog(session.supabase, session.actor, parsedId.data);
  const mappings = mapFields(fields, catalog);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { data: fillSession, error } = await session.supabase
    .from("fill_sessions")
    .insert({
      user_id: session.user.id,
      application_id: parsedId.data,
      origin,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !fillSession) {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({ data: null, error: { code: "SAVE_FAILED", message: "Could not store fill plan." }, requestId }),
        { status: 500 },
      ),
    );
  }

  if (mappings.length > 0) {
    await session.supabase.from("field_mappings").insert(
      mappings.map((item) => ({
        user_id: session.user.id,
        application_id: parsedId.data,
        fill_session_id: fillSession.id,
        field_key: item.fieldKey.slice(0, 180),
        label: item.label.slice(0, 180),
        value: item.proposedValue.slice(0, 4000),
        source: item.source.slice(0, 120),
        confidence: item.confidence,
        excluded_by_default: item.excludedByDefault,
        sensitive: item.sensitive,
      })),
    );
  }

  await recordAuditEvent(session.supabase, "fill.plan_created", {
    applicationId: parsedId.data,
    fillSessionId: fillSession.id,
    fieldCount: mappings.length,
  });

  return withExtensionCors(
    request,
    NextResponse.json(
      envelope.parse({
        data: {
          fillSessionId: fillSession.id,
          expiresAt,
          hazards: { captcha: false },
          mappings,
        },
        error: null,
        requestId,
      }),
    ),
  );
}
