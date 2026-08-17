import {
  createApiEnvelopeSchema,
  discoveryFiltersSchema,
  opportunityDiscoveryRequestSchema,
  uuidSchema,
} from "@1apply/contracts";
import { z } from "zod";
import { NextResponse } from "next/server";

import { getCurrentUserAndProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { parseDiscoveryQuery } from "@/server/opportunities/analyze";

const envelope = createApiEnvelopeSchema(
  z.object({
    requestId: uuidSchema,
    status: z.enum(["pending", "processing", "completed", "failed"]),
    filters: discoveryFiltersSchema,
    resultSummary: z.string().nullable(),
  }),
);

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      envelope.parse({
        data: null,
        error: { code: "INVALID_JSON", message: "Request body must be JSON." },
        requestId,
      }),
      { status: 400 },
    );
  }

  const parsed = opportunityDiscoveryRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      envelope.parse({
        data: null,
        error: { code: "VALIDATION", message: "Query must be 8–500 characters." },
        requestId,
      }),
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const filters = await parseDiscoveryQuery(parsed.data.query);

  const { data, error } = await supabase
    .from("discovery_requests")
    .insert({
      user_id: user.id,
      query: parsed.data.query,
      status: "completed",
      filters,
      result_summary:
        "Discovery architecture ready. Parsed filters stored — external feed matching will plug in here.",
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      envelope.parse({
        data: null,
        error: { code: "SAVE_FAILED", message: "Could not queue discovery request." },
        requestId,
      }),
      { status: 500 },
    );
  }

  return NextResponse.json(
    envelope.parse({
      data: {
        requestId: data.id,
        status: "completed",
        filters,
        resultSummary:
          "Discovery architecture ready. Parsed filters stored — external feed matching will plug in here.",
      },
      error: null,
      requestId,
    }),
    { status: 202 },
  );
}
