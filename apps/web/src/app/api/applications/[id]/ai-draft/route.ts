import { createApiEnvelopeSchema, uuidSchema } from "@1apply/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";
import { extensionPreflight, withExtensionCors } from "@/server/auth/extension-cors";
import { generateGroundedAiDraft } from "@/server/extension/enrich-ai-answers";
import { recordAuditEvent } from "@/server/audit";

const bodySchema = z.object({
  question: z.string().min(1).max(4000),
  fieldKey: z.string().max(200).optional(),
  guidance: z.string().max(1000).optional(),
  limitValue: z.number().int().positive().max(50_000).nullable().optional(),
  limitUnit: z.enum(["words", "characters"]).nullable().optional(),
});

const envelope = createApiEnvelopeSchema(
  z.object({
    draft: z.string(),
    grounded: z.boolean(),
    limitApplied: z.boolean().default(false),
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
        envelope.parse({ data: null, error: { code: "VALIDATION", message: "Invalid ai-draft payload." }, requestId }),
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
    const result = await generateGroundedAiDraft({
      supabase: session.supabase,
      actor: session.actor,
      applicationId: parsedId.data,
      question: parsed.data.question,
      guidance: parsed.data.guidance,
      limitValue: parsed.data.limitValue ?? null,
      limitUnit: parsed.data.limitUnit ?? null,
    });

    await recordAuditEvent(session.supabase, "extension.ai_draft", {
      applicationId: parsedId.data,
      fieldKey: parsed.data.fieldKey ?? null,
      hasGuidance: Boolean(parsed.data.guidance?.trim()),
      limitValue: parsed.data.limitValue ?? null,
      limitUnit: parsed.data.limitUnit ?? null,
      grounded: result.grounded,
    });

    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({
          data: {
            draft: result.draft,
            grounded: result.grounded,
            limitApplied: result.limitApplied,
          },
          error: null,
          requestId,
        }),
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "DRAFT_FAILED";
    const code = message === "AI_UNAVAILABLE" ? "AI_UNAVAILABLE" : "DRAFT_FAILED";
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({
          data: null,
          error: {
            code,
            message:
              code === "AI_UNAVAILABLE"
                ? "AI is not configured. Set OPENAI_API_KEY (or Gemini) on the server."
                : "Could not generate a draft from Application Memory.",
          },
          requestId,
        }),
        { status: code === "AI_UNAVAILABLE" ? 503 : 500 },
      ),
    );
  }
}
