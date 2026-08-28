import { createApiEnvelopeSchema } from "@1apply/contracts";
import { z } from "zod";
import { NextResponse } from "next/server";

import { loadAppConfig } from "@/config/env";
import { describeAiStatus } from "@/infra/ai/status";

const envelope = createApiEnvelopeSchema(
  z.object({
    ok: z.literal(true),
    ai: z.object({
      ready: z.boolean(),
      chatProvider: z.enum(["groq", "gemini", "none"]),
      chatModel: z.string().nullable(),
      embeddingsReady: z.boolean(),
      mode: z.enum(["auto", "groq", "gemini"]),
    }),
    supabaseConfigured: z.boolean(),
  }),
);

export async function GET() {
  const config = loadAppConfig();
  const ai = describeAiStatus();

  return NextResponse.json(
    envelope.parse({
      data: {
        ok: true,
        ai: {
          ready: ai.ready,
          chatProvider: ai.chatProvider,
          chatModel: ai.chatModel,
          embeddingsReady: ai.embeddingsReady,
          mode: ai.mode,
        },
        supabaseConfigured: Boolean(config.supabaseUrl && config.supabaseAnonKey),
      },
      error: null,
      requestId: crypto.randomUUID(),
    }),
  );
}
