import { createApiEnvelopeSchema, uuidSchema, BatchFillResponseSchema } from "@1apply/contracts";
import { NextResponse } from "next/server";

import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";
import { extensionPreflight, withExtensionCors } from "@/server/auth/extension-cors";
import { batchFillRequestBodySchema, runBatchFillPlan } from "@/server/extension/batch-fill";

const envelope = createApiEnvelopeSchema(
  BatchFillResponseSchema.extend({
    fillSessionId: uuidSchema.nullable(),
  }),
);

export function OPTIONS(request: Request) {
  return extensionPreflight(request);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const { id: applicationId } = await context.params;
  const parsedId = uuidSchema.safeParse(applicationId);
  if (!parsedId.success) {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({ data: null, error: { code: "VALIDATION", message: "Invalid application." }, requestId }),
        { status: 400 },
      ),
    );
  }

  let session;
  try {
    session = await requireApiSession(request);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return withExtensionCors(request, apiAuthResponse(error, envelope, requestId));
    }
    throw error;
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({ data: null, error: { code: "INVALID_JSON", message: "Request body must be JSON." }, requestId }),
        { status: 400 },
      ),
    );
  }

  const parsed = batchFillRequestBodySchema.safeParse({
    ...(json && typeof json === "object" ? json : {}),
    applicationId: parsedId.data,
  });
  if (!parsed.success) {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({ data: null, error: { code: "VALIDATION", message: "Invalid batch fill payload." }, requestId }),
        { status: 422 },
      ),
    );
  }

  if (parsed.data.applicationId !== parsedId.data) {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({
          data: null,
          error: { code: "VALIDATION", message: "applicationId does not match the URL." },
          requestId,
        }),
        { status: 422 },
      ),
    );
  }

  const { data: application } = await session.supabase
    .from("applications")
    .select("id")
    .eq("id", parsedId.data)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!application) {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({ data: null, error: { code: "NOT_FOUND", message: "Application not found." }, requestId }),
        { status: 404 },
      ),
    );
  }

  const result = await runBatchFillPlan({
    supabase: session.supabase,
    actor: session.actor,
    applicationId: parsedId.data,
    pageIndex: parsed.data.pageIndex,
    fields: parsed.data.fields,
    origin: parsed.data.origin,
  });

  return withExtensionCors(
    request,
    NextResponse.json(
      envelope.parse({
        data: {
          fields: result.fields,
          fillSessionId: result.fillSessionId,
        },
        error: null,
        requestId,
      }),
    ),
  );
}
