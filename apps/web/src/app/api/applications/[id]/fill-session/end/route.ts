import {
  createApiEnvelopeSchema,
  fillSessionEndRequestSchema,
  fillSessionEndResponseSchema,
  uuidSchema,
  applicationStatusSchema,
} from "@1apply/contracts";
import { NextResponse } from "next/server";

import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";
import { extensionPreflight, withExtensionCors } from "@/server/auth/extension-cors";
import { endFillSession } from "@/server/applications/fill-lifecycle";

const envelope = createApiEnvelopeSchema(fillSessionEndResponseSchema);

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
        envelope.parse({
          data: null,
          error: { code: "VALIDATION", message: "Invalid application." },
          requestId,
        }),
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
        envelope.parse({
          data: null,
          error: { code: "INVALID_JSON", message: "Request body must be JSON." },
          requestId,
        }),
        { status: 400 },
      ),
    );
  }

  const parsed = fillSessionEndRequestSchema.safeParse(json);
  if (!parsed.success) {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({
          data: null,
          error: { code: "VALIDATION", message: "Invalid fill-session end payload." },
          requestId,
        }),
        { status: 422 },
      ),
    );
  }

  try {
    const result = await endFillSession({
      supabase: session.supabase,
      actor: session.actor,
      applicationId: parsedId.data,
      reason: parsed.data.reason,
      origin: parsed.data.origin,
      fillSessionId: parsed.data.fillSessionId,
      pageUrl: parsed.data.pageUrl,
      pageText: parsed.data.pageText,
      fields: parsed.data.fields,
    });

    const statusParsed = applicationStatusSchema.safeParse(result.status);
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({
          data: {
            applicationId: result.applicationId,
            status: statusParsed.success ? statusParsed.data : "in_progress",
            nextAction: result.nextAction,
            savedFieldCount: result.savedFieldCount,
            needsYouCount: result.needsYouCount,
            submitted: result.submitted,
            submissionSignal: result.submissionSignal,
          },
          error: null,
          requestId,
        }),
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "SAVE_FAILED";
    const status = message === "NOT_FOUND" ? 404 : 500;
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({
          data: null,
          error: {
            code: message === "NOT_FOUND" ? "NOT_FOUND" : "SAVE_FAILED",
            message: message === "NOT_FOUND" ? "Application not found." : "Could not end fill session.",
          },
          requestId,
        }),
        { status },
      ),
    );
  }
}
