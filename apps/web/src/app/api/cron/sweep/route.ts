import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { runGlobalAutomationSweep } from "@/server/automation/run-global-sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.startsWith("replace-with")) return false;
  const auth = request.headers.get("authorization")?.trim();
  return auth === `Bearer ${secret}`;
}

async function handleSweep() {
  try {
    const result = await runGlobalAutomationSweep();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logError("automation.cron_sweep_failed", { err });
    return NextResponse.json({ ok: false, error: "sweep_failed" }, { status: 500 });
  }
}

/** EC2 crontab hits this every 15 minutes. Requires Authorization: Bearer CRON_SECRET */
export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return handleSweep();
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return handleSweep();
}
