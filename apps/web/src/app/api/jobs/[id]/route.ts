import { createApiEnvelopeSchema, toJobLifecycle, uuidSchema } from "@1apply/contracts";
import { z } from "zod";
import { NextResponse } from "next/server";

import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";

const envelope = createApiEnvelopeSchema(
  z.object({
    id: uuidSchema,
    type: z.string(),
    state: z.enum(["queued", "processing", "completed", "failed"]),
    attempts: z.number(),
    errorCode: z.string().nullable(),
  }),
);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const { id } = await context.params;

  let session;
  try {
    session = await requireApiSession(request);
  } catch (error) {
    if (error instanceof ApiAuthError) return apiAuthResponse(error, envelope, requestId);
    throw error;
  }

  const { data, error } = await session.supabase
    .from("jobs")
    .select("id, type, state, attempts, error_code")
    .eq("id", id)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      envelope.parse({
        data: null,
        error: { code: "NOT_FOUND", message: "Job not found." },
        requestId,
      }),
      { status: 404 },
    );
  }

  return NextResponse.json(
    envelope.parse({
      data: {
        id: data.id,
        type: data.type,
        state: toJobLifecycle(data.state),
        attempts: data.attempts,
        errorCode: data.error_code,
      },
      error: null,
      requestId,
    }),
  );
}
