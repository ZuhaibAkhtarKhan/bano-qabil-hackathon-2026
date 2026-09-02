import { createApiEnvelopeSchema, uuidSchema } from "@1apply/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import type { Actor } from "@/auth/actor";
import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";
import { extensionPreflight, withExtensionCors } from "@/server/auth/extension-cors";
import {
  completeHostSubmitJob,
  markHostSubmitJobRunning,
} from "@/server/applications/host-submit";

const bodySchema = z.object({
  jobId: uuidSchema,
  running: z.boolean().optional(),
  submitted: z.boolean().optional(),
  hostSubmitClicked: z.boolean().optional(),
  error: z.string().nullable().optional(),
  blockedReason: z.string().nullable().optional(),
});

const envelope = createApiEnvelopeSchema(z.object({ ok: z.boolean() }));

export function OPTIONS(request: Request) {
  return extensionPreflight(request);
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const session = await requireApiSession(request);
    const body = bodySchema.parse(await request.json());
    const actor: Actor = {
      userId: session.user.id,
      email: session.profile.email,
      profile: session.profile,
    };

    if (body.running) {
      await markHostSubmitJobRunning(session.supabase, actor.userId, body.jobId);
      return withExtensionCors(
        request,
        NextResponse.json(envelope.parse({ data: { ok: true }, error: null, requestId })),
      );
    }

    const result = await completeHostSubmitJob({
      supabase: session.supabase,
      actor,
      jobId: body.jobId,
      submitted: Boolean(body.submitted),
      hostSubmitClicked: Boolean(body.hostSubmitClicked),
      error: body.error ?? null,
      blockedReason: body.blockedReason ?? null,
    });

    return withExtensionCors(
      request,
      NextResponse.json(envelope.parse({ data: result, error: null, requestId })),
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return withExtensionCors(request, apiAuthResponse(error, envelope, requestId));
    }
    throw error;
  }
}
