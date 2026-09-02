import { createServiceRoleSupabaseClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/log";

import { isServerHostSubmitEnabled } from "./playwright-host-submit";
import { runServerHostSubmitWorker } from "./host-submit-worker";

/** Process due host prefill/submit jobs immediately (best-effort, non-blocking). */
export async function kickHostSubmitWorkerIfEnabled(): Promise<void> {
  if (!isServerHostSubmitEnabled()) return;
  try {
    const supabase = createServiceRoleSupabaseClient();
    await runServerHostSubmitWorker(supabase);
  } catch (err) {
    logError("host_submit.worker_kick_failed", { err });
  }
}
