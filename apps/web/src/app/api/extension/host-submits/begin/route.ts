import { createApiEnvelopeSchema } from "@1apply/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";
import { extensionPreflight, withExtensionCors } from "@/server/auth/extension-cors";
import {
  beginHostJobFromExtension,
  ExtensionHostSubmitBeginSchema,
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

/** Extension re-checks a claimed job before opening the form / clicking Submit. */
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

    const parsed = ExtensionHostSubmitBeginSchema.safeParse(json);
    if (!parsed.success) {
      return withExtensionCors(
        request,
        NextResponse.json(
          envelope.parse({
            data: null,
            error: { code: "VALIDATION", message: "Invalid host-submit begin payload." },
            requestId,
          }),
          { status: 422 },
        ),
      );
    }

    const result = await beginHostJobFromExtension({
      actor: session.actor,
      jobId: parsed.data.jobId,
    });

    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({
          data: { ok: result.ok, reason: result.reason },
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
