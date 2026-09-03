import { createApiEnvelopeSchema } from "@1apply/contracts";
import { after } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";
import { extensionPreflight, withExtensionCors } from "@/server/auth/extension-cors";
import { kickHostSubmitWorkerIfEnabled } from "@/server/applications/host-submit-worker-kick";

const envelope = createApiEnvelopeSchema(
  z.object({
    ok: z.boolean(),
    serverOwned: z.literal(true),
  }),
);

export function OPTIONS(request: Request) {
  return extensionPreflight(request);
}

/**
 * Legacy extension complete endpoint.
 * Extension must not claim or complete host-submit jobs — server Playwright owns them.
 */
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    await requireApiSession(request);
    after(() => {
      void kickHostSubmitWorkerIfEnabled();
    });
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({ data: { ok: true, serverOwned: true }, error: null, requestId }),
      ),
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return withExtensionCors(request, apiAuthResponse(error, envelope, requestId));
    }
    throw error;
  }
}
