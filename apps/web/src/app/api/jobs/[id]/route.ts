import { createApiEnvelopeSchema, toJobLifecycle, uuidSchema } from "@1apply/contracts";
import { z } from "zod";
import { NextResponse } from "next/server";

import { getCurrentUserAndProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

const envelope = createApiEnvelopeSchema(
  z.object({
    id: uuidSchema,
    type: z.string(),
    state: z.enum(["queued", "processing", "completed", "failed"]),
    attempts: z.number(),
    errorCode: z.string().nullable(),
  }),
);

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const { id } = await context.params;

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      envelope.parse({
        data: null,
        error: { code: "NOT_CONFIGURED", message: "Supabase is not configured." },
        requestId,
      }),
      { status: 503 },
    );
  }

  const { user } = await getCurrentUserAndProfile();
  if (!user) {
    return NextResponse.json(
      envelope.parse({
        data: null,
        error: { code: "UNAUTHENTICATED", message: "Sign in required." },
        requestId,
      }),
      { status: 401 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, type, state, attempts, error_code")
    .eq("id", id)
    .eq("user_id", user.id)
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
