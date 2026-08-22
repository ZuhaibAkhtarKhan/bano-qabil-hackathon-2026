import {
  createApiEnvelopeSchema,
  discoveryFiltersSchema,
  opportunityDiscoveryRequestSchema,
  uuidSchema,
} from "@1apply/contracts";
import { z } from "zod";
import { NextResponse } from "next/server";

import { parseDiscoveryQuery } from "@/server/opportunities/analyze";
import { runOpportunityDiscovery } from "@/server/opportunities/discover";
import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";
import { recordAuditEvent } from "@/server/audit";

const envelope = createApiEnvelopeSchema(
  z.object({
    requestId: uuidSchema,
    status: z.enum(["pending", "processing", "completed", "failed"]),
    filters: discoveryFiltersSchema,
    resultSummary: z.string().nullable(),
    resultCount: z.number().int().nonnegative(),
  }),
);

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();

  let session;
  try {
    session = await requireApiSession(request);
  } catch (error) {
    if (error instanceof ApiAuthError) return apiAuthResponse(error, envelope, requestId);
    throw error;
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

  const { supabase, actor } = session;
  const filters = await parseDiscoveryQuery(parsed.data.query);

  try {
    const result = await runOpportunityDiscovery({
      supabase,
      actor,
      query: parsed.data.query,
      parsedFilters: filters,
    });

    await recordAuditEvent(supabase, "opportunity.discover", {
      requestId: result.requestId,
      resultCount: result.results.length,
    });

    return NextResponse.json(
      envelope.parse({
        data: {
          requestId: result.requestId,
          status: "completed",
          filters: result.filters,
          resultSummary: result.summary,
          resultCount: result.results.length,
        },
        error: null,
        requestId,
      }),
      { status: 202 },
    );
  } catch {
    return NextResponse.json(
      envelope.parse({
        data: null,
        error: { code: "SAVE_FAILED", message: "Could not run discovery." },
        requestId,
      }),
      { status: 500 },
    );
  }
}
