import { createApiEnvelopeSchema } from "@1apply/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";
import { extensionPreflight, withExtensionCors } from "@/server/auth/extension-cors";
import {
  completeHostJobFromExtension,
  ExtensionHostSubmitCompleteSchema,
} from "@/server/extension/extension-host-submit";

const envelope = createApiEnvelopeSchema(
  z.object({
    ok: z.boolean(),
    reason: z.string().optional(),
  }),
);

export function OPTIONS(request: Request) {
  return extensionPreflight(request);
}

/** Extension reports the result of a claimed host fill/submit job. */
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const session = await requireApiSession(request);
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

    const parsed = ExtensionHostSubmitCompleteSchema.safeParse(json);
    if (!parsed.success) {
      return withExtensionCors(
        request,
        NextResponse.json(
          envelope.parse({
            data: null,
            error: { code: "VALIDATION", message: "Invalid host-submit complete payload." },
            requestId,
          }),
          { status: 422 },
        ),
      );
    }

    const result = await completeHostJobFromExtension({
      supabase: session.supabase,
      actor: session.actor,
      body: parsed.data,
    });

    if (!result.ok) {
      return withExtensionCors(
        request,
        NextResponse.json(
          envelope.parse({
            data: null,
            error: {
              code: result.reason === "not_found" ? "NOT_FOUND" : "SAVE_FAILED",
              message: result.reason ?? "Could not complete host submit job.",
            },
            requestId,
          }),
          { status: result.reason === "not_found" ? 404 : 500 },
        ),
      );
    }

    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({
          data: { ok: true, reason: result.reason },
          error: null,
          requestId,
        }),
      ),
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return withExtensionCors(request, apiAuthResponse(error, envelope, requestId));
    }
    throw error;
  }
}
