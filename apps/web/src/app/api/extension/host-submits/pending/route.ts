import { createApiEnvelopeSchema, uuidSchema } from "@1apply/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";
import { extensionPreflight, withExtensionCors } from "@/server/auth/extension-cors";
import { listPendingHostSubmitJobs } from "@/server/applications/host-submit";

const envelope = createApiEnvelopeSchema(
  z.array(
    z.object({
      id: uuidSchema,
      applicationId: uuidSchema,
      sourceUrl: z.string().url(),
      dueAt: z.string(),
      status: z.string(),
      attemptCount: z.number().int(),
    }),
  ),
);

export function OPTIONS(request: Request) {
  return extensionPreflight(request);
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const session = await requireApiSession(request);
    const jobs = await listPendingHostSubmitJobs(session.supabase, session.user.id);
    const rows = jobs.map((job) => ({
      id: job.id,
      applicationId: job.application_id,
      sourceUrl: job.source_url,
      dueAt: job.due_at,
      status: job.status,
      attemptCount: job.attempt_count,
    }));

    return withExtensionCors(
      request,
      NextResponse.json(envelope.parse({ data: rows, error: null, requestId })),
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return withExtensionCors(request, apiAuthResponse(error, envelope, requestId));
    }
    throw error;
  }
}
