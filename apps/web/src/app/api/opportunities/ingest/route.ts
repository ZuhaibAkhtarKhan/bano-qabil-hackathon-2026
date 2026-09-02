import { revalidatePath } from "next/cache";
import { createApiEnvelopeSchema, opportunityIngestRequestSchema, uuidSchema } from "@1apply/contracts";
import { z } from "zod";
import { NextResponse } from "next/server";

import { parsePublicHttpUrl, UnsafeUrlError } from "@/lib/security/public-url";
import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";
import { extensionPreflight, withExtensionCors } from "@/server/auth/extension-cors";
import { fetchPublicPageText } from "@/server/ingest/fetch-page";
import { ingestFormPageCapture } from "@/server/extension/ingest-form-page";
import { ingestOpportunityPage } from "@/server/opportunities/ingest";
import { recordAuditEvent } from "@/server/audit";

const envelope = createApiEnvelopeSchema(
  z.object({
    opportunityId: uuidSchema,
    applicationId: uuidSchema,
    jobId: uuidSchema.nullable(),
    duplicate: z.boolean(),
    analysisStatus: z.enum(["pending", "ready", "failed", "needs_input"]),
  }),
);

export function OPTIONS(request: Request) {
  return extensionPreflight(request);
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();

  let session;
  try {
    session = await requireApiSession(request);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return withExtensionCors(request, apiAuthResponse(error, envelope, requestId));
    }
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
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

  const parsed = opportunityIngestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({
          data: null,
          error: { code: "VALIDATION", message: "Invalid ingest payload." },
          requestId,
        }),
        { status: 400 },
      ),
    );
  }

  try {
    parsePublicHttpUrl(parsed.data.url);
  } catch (error) {
    const code = error instanceof UnsafeUrlError ? "UNSAFE_URL" : "VALIDATION";
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({
          data: null,
          error: { code, message: "Only public http(s) URLs can be ingested." },
          requestId,
        }),
        { status: 422 },
      ),
    );
  }

  const { supabase, actor, user } = session;

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
      return withExtensionCors(
        request,
        NextResponse.json(
          envelope.parse({
            data: null,
            error: { code, message: "Could not fetch the opportunity page." },
            requestId,
          }),
          { status: 422 },
        ),
      );
    }
  } else {
    canonicalUrl = parsePublicHttpUrl(parsed.data.url).toString();
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

    if (parsed.data.formPage?.fields?.length) {
      await ingestFormPageCapture({
        supabase,
        actor,
        userId: user.id,
        applicationId: result.applicationId,
        opportunityId: result.opportunityId,
        formPage: parsed.data.formPage,
        prefill: !result.duplicate,
      });
    }

    await recordAuditEvent(supabase, "opportunity.ingest", {
      opportunityId: result.opportunityId,
      duplicate: result.duplicate,
      source: parsed.data.source,
    });

    revalidatePath("/app");
    revalidatePath("/app/applications");
    revalidatePath("/app/opportunities");

    return withExtensionCors(
      request,
      NextResponse.json(
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
      ),
    );
  } catch {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({
          data: null,
          error: { code: "INGEST_FAILED", message: "Could not ingest opportunity." },
          requestId,
        }),
        { status: 500 },
      ),
    );
  }
}
