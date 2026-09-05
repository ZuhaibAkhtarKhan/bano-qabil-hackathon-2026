import type { Locator, Page } from "./host-page";

function normalizeHostHeading(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\bYour answer\b/gi, " ")
    .replace(/\s*\*\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Resolve a captured Google Forms / host question card by stamp or heading text. */
export async function findHostFieldScope(
  page: Page,
  entry: { fieldId: string; label?: string },
): Promise<Locator | null> {
  const byId = page.locator(`[data-1apply-batch-id="${entry.fieldId}"]`).first();
  if ((await byId.count()) > 0) return byId;
  const want = normalizeHostHeading(entry.label ?? "");
  if (want.length < 2) return null;
  const items = page.locator('[role="listitem"]');
  const count = await items.count();
  for (let index = 0; index < count; index += 1) {
    const item = items.nth(index);
    const heading = item
      .locator('[role="heading"], .M7eMe, .freebirdFormviewerComponentsQuestionBaseTitle')
      .first();
    const text = normalizeHostHeading((await heading.textContent().catch(() => "")) ?? "");
    if (!text) continue;
    if (text === want || text.includes(want) || want.includes(text)) {
      await item.evaluate((el, id) => el.setAttribute("data-1apply-batch-id", id), entry.fieldId).catch(() => undefined);
      return item;
    }
  }
  return null;
}
