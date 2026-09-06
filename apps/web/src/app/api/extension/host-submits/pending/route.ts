import { createApiEnvelopeSchema } from "@1apply/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";
import { extensionPreflight, withExtensionCors } from "@/server/auth/extension-cors";
import {
  claimPendingHostJobsForExtension,
  ExtensionHostSubmitJobSchema,
} from "@/server/extension/extension-host-submit";

const envelope = createApiEnvelopeSchema(z.array(ExtensionHostSubmitJobSchema));

export function OPTIONS(request: Request) {
  return extensionPreflight(request);
}

/** Extension polls for due host_submit_jobs and claims them for in-browser fill/submit. */
export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const session = await requireApiSession(request);
    const jobs = await claimPendingHostJobsForExtension({
      supabase: session.supabase,
      actor: session.actor,
    });
    return withExtensionCors(
      request,
      NextResponse.json(envelope.parse({ data: jobs, error: null, requestId })),
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return withExtensionCors(request, apiAuthResponse(error, envelope, requestId));
    }
    throw error;
  }
}
