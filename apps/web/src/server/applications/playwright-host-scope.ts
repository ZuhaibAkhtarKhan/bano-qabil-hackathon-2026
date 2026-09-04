import type { Locator, Page } from "playwright";

/** Resolve a captured Google Forms / host question card by stamp or heading text. */
export async function findHostFieldScope(
  page: Page,
  entry: { fieldId: string; label?: string },
): Promise<Locator | null> {
  const byId = page.locator(`[data-1apply-batch-id="${entry.fieldId}"]`).first();
  if ((await byId.count()) > 0) return byId;
  const label = entry.label?.replace(/\s+/g, " ").trim() ?? "";
  if (label.length < 2) return null;
  const items = page.locator('[role="listitem"]');
  const count = await items.count();
  const want = label.toLowerCase();
  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    const heading = item
      .locator('[role="heading"], .M7eMe, .freebirdFormviewerComponentsQuestionBaseTitle')
      .first();
    const text = ((await heading.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!text) continue;
    if (text === want || text.includes(want) || want.includes(text)) return item;
  }
  return null;
}
