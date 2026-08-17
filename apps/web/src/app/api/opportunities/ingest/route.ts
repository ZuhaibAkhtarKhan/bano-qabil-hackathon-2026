import { createApiEnvelopeSchema, opportunityIngestRequestSchema, uuidSchema } from "@1apply/contracts";
import { z } from "zod";
import { NextResponse } from "next/server";

import { UnsafeUrlError } from "@/lib/security/public-url";
import { getCurrentUserAndProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { toActor } from "@/auth/actor";
import { fetchPublicPageText } from "@/server/ingest/fetch-page";
import { ingestOpportunityPage } from "@/server/opportunities/ingest";

const envelope = createApiEnvelopeSchema(
  z.object({
    opportunityId: uuidSchema,
    applicationId: uuidSchema,
    jobId: uuidSchema.nullable(),
    duplicate: z.boolean(),
    analysisStatus: z.enum(["pending", "ready", "failed", "needs_input"]),
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

  const { user, profile } = await getCurrentUserAndProfile();
  if (!user || !profile) {
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

  const parsed = opportunityIngestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      envelope.parse({
        data: null,
        error: { code: "VALIDATION", message: "Invalid ingest payload." },
        requestId,
      }),
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const actor = toActor(user, profile);

  let pageText = parsed.data.metadata?.pageText ?? "";
  let canonicalUrl = parsed.data.url;
  let pageTitle = parsed.data.metadata?.title ?? parsed.data.url;

  if (!pageText) {
    try {
      const page = await fetchPublicPageText(parsed.data.url);
      pageText = page.text;
      canonicalUrl = page.url;
      pageTitle = page.title;
    } catch (error) {
      const code = error instanceof UnsafeUrlError ? "UNSAFE_URL" : "PAGE_FETCH";
      return NextResponse.json(
        envelope.parse({
          data: null,
          error: { code, message: "Could not fetch the opportunity page." },
          requestId,
        }),
        { status: 422 },
      );
    }
  }

  try {
    const result = await ingestOpportunityPage({
      supabase,
      actor,
      userId: user.id,
      source: parsed.data.source,
      sourceUrl: parsed.data.url,
      canonicalUrl,
      pageText,
      pageTitle,
      metadata: parsed.data.metadata ?? {},
    });

    return NextResponse.json(
      envelope.parse({
        data: {
          opportunityId: result.opportunityId,
          applicationId: result.applicationId,
          jobId: result.jobId || null,
          duplicate: result.duplicate,
          analysisStatus: result.duplicate ? "ready" : "pending",
        },
        error: null,
        requestId,
      }),
      { status: result.duplicate ? 200 : 202 },
    );
  } catch {
    return NextResponse.json(
      envelope.parse({
        data: null,
        error: { code: "INGEST_FAILED", message: "Could not ingest opportunity." },
        requestId,
      }),
      { status: 500 },
    );
  }
}
