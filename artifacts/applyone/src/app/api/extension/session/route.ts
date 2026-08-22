import { createApiEnvelopeSchema } from "@1apply/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";
import { extensionPreflight, withExtensionCors } from "@/server/auth/extension-cors";

const envelope = createApiEnvelopeSchema(
  z.object({
    email: z.string(),
    connected: z.literal(true),
  }),
);

export function OPTIONS(request: Request) {
  return extensionPreflight(request);
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const session = await requireApiSession(request);
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({
          data: { email: session.profile.email, connected: true },
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
