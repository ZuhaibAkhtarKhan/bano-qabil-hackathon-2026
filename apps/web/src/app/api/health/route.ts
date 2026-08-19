import { createApiEnvelopeSchema } from "@1apply/contracts";
import { z } from "zod";
import { NextResponse } from "next/server";

const envelope = createApiEnvelopeSchema(
  z.object({
    ok: z.literal(true),
  }),
);

export async function GET() {
  return NextResponse.json(
    envelope.parse({
      data: { ok: true },
      error: null,
      requestId: crypto.randomUUID(),
    }),
  );
}
