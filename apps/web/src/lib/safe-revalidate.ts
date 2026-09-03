import { revalidatePath } from "next/cache";

/**
 * revalidatePath throws when called during RSC render (e.g. dashboard load
 * that kicks the host-submit worker). Background jobs must never fail for that.
 */
export function safeRevalidatePath(path: string): void {
  try {
    revalidatePath(path);
  } catch {
    // Ignore — caller is outside a mutation / after-render context.
  }
}
