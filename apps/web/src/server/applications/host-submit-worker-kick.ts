import { after } from "next/server";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/log";

import { isServerHostSubmitEnabled } from "./playwright-host-submit";
import { runServerHostSubmitWorker } from "./host-submit-worker";

async function runWorkerOnce(): Promise<void> {
  const supabase = createServiceRoleSupabaseClient();
  await runServerHostSubmitWorker(supabase);
}

/**
 * Process due host prefill/submit jobs.
 * Prefer Next.js `after()` so Playwright + revalidatePath never run mid-RSC render
 * (e.g. dashboard load → syncDeadlineReminders → kick).
 */
export async function kickHostSubmitWorkerIfEnabled(): Promise<void> {
  if (!isServerHostSubmitEnabled()) return;

  const run = () =>
    runWorkerOnce().catch((err) => {
      logError("host_submit.worker_kick_failed", { err });
    });

  // Prefer scheduling outside the current render/action stack when possible.
  // Cron routes should call runHostSubmitWorkerNow() / runServerHostSubmitWorker directly.
  try {
    after(run);
    return;
  } catch {
    // after() unavailable outside a request — fall through.
  }
  await run();
}

/** Cron / explicit API: run the worker in-process and await completion. */
export async function runHostSubmitWorkerNow(): Promise<void> {
  if (!isServerHostSubmitEnabled()) return;
  try {
    await runWorkerOnce();
  } catch (err) {
    logError("host_submit.worker_kick_failed", { err });
    throw err;
  }
}
