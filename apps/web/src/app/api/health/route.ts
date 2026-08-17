import { createApiEnvelopeSchema } from "@1apply/contracts";
import { z } from "zod";
import { NextResponse } from "next/server";

import { loadAppConfig } from "@/config/env";
import { isSupabaseConfigured } from "@/lib/env";

const envelope = createApiEnvelopeSchema(
  z.object({
    ok: z.literal(true),
    supabase: z.boolean(),
    openai: z.boolean(),
  }),
);

export async function GET() {
  const config = loadAppConfig();
  return NextResponse.json(
    envelope.parse({
      data: {
        ok: true,
        supabase: isSupabaseConfigured(),
        openai: config.openaiConfigured,
      },
      error: null,
      requestId: crypto.randomUUID(),
    }),
  );
}
