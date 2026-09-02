import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/admin";
import { runServerHostSubmitWorker } from "@/server/applications/host-submit-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.startsWith("replace-with")) return false;
  const auth = request.headers.get("authorization")?.trim();
  return auth === `Bearer ${secret}`;
}

async function handleWorker() {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const result = await runServerHostSubmitWorker(supabase);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logError("automation.host_submit_worker_failed", { err });
    return NextResponse.json({ ok: false, error: "host_submit_worker_failed" }, { status: 500 });
  }
}

/** EC2 cron — headless Playwright fill + submit. No Chrome extension required. */
export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return handleWorker();
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return handleWorker();
}
