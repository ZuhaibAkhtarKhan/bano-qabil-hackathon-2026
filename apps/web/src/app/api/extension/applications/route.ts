import { createApiEnvelopeSchema, uuidSchema } from "@1apply/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";
import { extensionPreflight, withExtensionCors } from "@/server/auth/extension-cors";

const envelope = createApiEnvelopeSchema(
  z.array(
    z.object({
      id: uuidSchema,
      title: z.string(),
      organization: z.string().nullable(),
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
    const { data } = await session.supabase
      .from("applications")
      .select("id, opportunities ( title, organization )")
      .eq("user_id", session.user.id)
      .order("updated_at", { ascending: false })
      .limit(40);

    const rows = (data ?? []).map((row) => {
      const opportunity = Array.isArray(row.opportunities) ? row.opportunities[0] : row.opportunities;
      return {
        id: row.id as string,
        title: (opportunity as { title?: string } | null)?.title ?? "Untitled opportunity",
        organization: (opportunity as { organization?: string | null } | null)?.organization ?? null,
      };
    });

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
