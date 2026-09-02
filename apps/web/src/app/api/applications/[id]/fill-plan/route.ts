import { createApiEnvelopeSchema, uuidSchema } from "@1apply/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";
import { extensionPreflight, withExtensionCors } from "@/server/auth/extension-cors";
import { fillLegacyFormPageFromJson, parseDetectedFields } from "@/server/extension/form-fill-from-json";

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

const hazardsSchema = z
  .object({
    captcha: z.boolean().default(false),
    captchaVendor: z.string().nullable().optional(),
    captchaMessage: z.string().nullable().optional(),
    accountCreation: z.boolean().default(false),
    accountMessage: z.string().nullable().optional(),
    unsupported: z.boolean().default(false),
    unsupportedReason: z.string().nullable().optional(),
    hasSubmitControl: z.boolean().optional(),
  })
  .partial()
  .default({});

const bodySchema = z.object({
  origin: z.string().url(),
  fields: z.array(fieldSchema).max(80),
  hazards: hazardsSchema,
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
        options: z
          .array(z.object({ value: z.string(), label: z.string(), source: z.string() }))
          .default([]),
        approvalState: z.string(),
        sensitive: z.boolean(),
        excludedByDefault: z.boolean(),
        reason: z.string(),
        fieldType: z.string(),
        aiAnswerable: z.boolean().default(false),
        showChip: z.boolean().default(false),
        attachment: z
          .object({
            documentId: z.string(),
            versionId: z.string(),
            filename: z.string(),
            mimeType: z.string(),
            byteSize: z.number(),
          })
          .nullable()
          .optional(),
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

  try {
    const result = await fillLegacyFormPageFromJson({
      supabase: session.supabase,
      actor: session.actor,
      applicationId: parsedId.data,
      origin: parsed.data.origin,
      fields: parseDetectedFields(parsed.data.fields),
      hazards: parsed.data.hazards,
    });

    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({
          data: {
            fillSessionId: result.fillSessionId,
            expiresAt: result.expiresAt,
            hazards: result.hazards,
            mappings: result.mappings,
          },
          error: null,
          requestId,
        }),
      ),
    );
  } catch {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({ data: null, error: { code: "SAVE_FAILED", message: "Could not store fill plan." }, requestId }),
        { status: 500 },
      ),
    );
  }
}
