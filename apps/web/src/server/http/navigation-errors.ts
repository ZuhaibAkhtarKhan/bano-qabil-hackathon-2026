/** Rethrow Next.js redirect/notFound errors so catch blocks do not turn success into upload failures. */
export function rethrowNavigationError(error: unknown): void {
  if (typeof error !== "object" || error === null || !("digest" in error)) return;
  const digest = String((error as { digest?: unknown }).digest ?? "");
  if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND")) {
    throw error;
  }
}
