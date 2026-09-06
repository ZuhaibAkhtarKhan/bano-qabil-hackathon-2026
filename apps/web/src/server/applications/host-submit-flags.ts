/**
 * Host automation flags.
 * Scheduling (jobs, deadlines) is independent of which executor fills the form.
 * Extension is the primary executor; Playwright is an optional server fallback.
 */

import { logError } from "@/lib/log";

function envFlag(name: string, defaultOn: boolean): boolean {
  const flag = process.env[name]?.trim().toLowerCase();
  if (flag == null || flag === "") return defaultOn;
  if (flag === "0" || flag === "false" || flag === "off" || flag === "no") return false;
  if (flag === "1" || flag === "true" || flag === "on" || flag === "yes") return true;
  return defaultOn;
}

/** Queue prefill/submit jobs when prepareAndSendIfSilent is on — does not require Playwright. */
export function isHostAutomationSchedulingEnabled(): boolean {
  return envFlag("ENABLE_HOST_AUTOMATION_SCHEDULE", true);
}

/**
 * Extension executes due host_submit_jobs (fill + Next/Submit in the user's browser).
 * Default on — this is the primary path for signed-in forms.
 */
export function isExtensionHostSubmitEnabled(): boolean {
  return envFlag("ENABLE_EXTENSION_HOST_SUBMIT", true);
}

/**
 * Server Playwright fallback when the extension cannot run the job.
 * Default off — prefer the user's browser session.
 */
export function isServerHostSubmitEnabled(): boolean {
  const enabled = envFlag("ENABLE_SERVER_HOST_SUBMIT", false);
  if (!enabled) {
    // Avoid noisy logs on every worker kick — only when explicitly off after being set.
    if (process.env.ENABLE_SERVER_HOST_SUBMIT?.trim()) {
      logError("host_submit.server_disabled", {
        hint: "ENABLE_SERVER_HOST_SUBMIT is off — extension owns host fill/submit.",
      });
    }
  }
  return enabled;
}
