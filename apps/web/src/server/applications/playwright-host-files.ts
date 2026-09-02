import type { Page, Frame } from "playwright";

import type { DocumentVersionUpload } from "@/server/documents/download-version";

import type { FillPlanEntry } from "./playwright-form-dom";

function basename(filename: string): string {
  return filename.trim().toLowerCase().replace(/^.*[\\/]/, "");
}

async function fileAlreadyUploaded(scope: ReturnType<Page["locator"]>, filename: string): Promise<boolean> {
  const wanted = basename(filename);
  if (!wanted) return false;

  const inputCount = await scope.locator('input[type="file"]').count();
  for (let i = 0; i < inputCount; i += 1) {
    const files = await scope.locator('input[type="file"]').nth(i).evaluate((el) =>
      Array.from((el as HTMLInputElement).files ?? []).map((item) => item.name.toLowerCase()),
    );
    if (files.some((name) => name === wanted || name.endsWith(wanted))) return true;
  }

  const text = ((await scope.innerText().catch(() => "")) || "").toLowerCase();
  if (text.includes(wanted) && /uploaded|selected|attached|remove file/i.test(text)) return true;
  return false;
}

async function setFilesOnFrame(
  frame: Frame,
  file: DocumentVersionUpload,
): Promise<boolean> {
  const inputs = frame.locator('input[type="file"]');
  const count = await inputs.count();
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    const already = await input.evaluate((el, wanted) => {
      const names = Array.from((el as HTMLInputElement).files ?? []).map((item) => item.name.toLowerCase());
      const target = String(wanted).toLowerCase();
      return names.some((name) => name === target || name.endsWith(target));
    }, basename(file.filename));
    if (already) return true;

    try {
      await input.setInputFiles({
        name: file.filename,
        mimeType: file.mimeType,
        buffer: file.buffer,
      });
      const attached = await input.evaluate((el) => (el as HTMLInputElement).files?.length ?? 0);
      if (attached > 0) return true;
    } catch {
      // Try the next input.
    }
  }
  return false;
}

/** Attach vault documents to file inputs via Playwright (Node-side — not page.evaluate). */
export async function applyHostFileUploads(
  page: Page,
  entries: FillPlanEntry[],
  files: Map<string, DocumentVersionUpload>,
): Promise<number> {
  let filled = 0;

  for (const entry of entries) {
    if (entry.status !== "filled" || entry.type !== "file" || !entry.documentVersionId) continue;
    const file = files.get(entry.documentVersionId);
    if (!file) continue;

    const container = page.locator(`[data-1apply-batch-id="${entry.fieldId}"]`).first();
    if ((await container.count()) === 0) continue;
    if (await fileAlreadyUploaded(container, file.filename)) {
      filled += 1;
      continue;
    }

    let attached = false;
    for (let attempt = 0; attempt < 8 && !attached; attempt += 1) {
      if (attempt > 0) await page.waitForTimeout(350);

      const addBtn = container
        .locator('button, [role="button"], span[role="link"], a')
        .filter({ hasText: /add file|upload file|browse|choose file|attach/i });
      if ((await addBtn.count()) > 0) {
        await addBtn.first().click().catch(() => undefined);
        await page.waitForTimeout(500);
      }

      const scopedInput = container.locator('input[type="file"]').first();
      if ((await scopedInput.count()) > 0) {
        try {
          await scopedInput.setInputFiles({
            name: file.filename,
            mimeType: file.mimeType,
            buffer: file.buffer,
          });
          attached = (await scopedInput.evaluate((el) => (el as HTMLInputElement).files?.length ?? 0)) > 0;
        } catch {
          attached = false;
        }
      }

      if (!attached) {
        for (const frame of page.frames()) {
          if (await setFilesOnFrame(frame, file)) {
            attached = true;
            break;
          }
        }
      }

      if (!attached) {
        const pageInput = page.locator('input[type="file"]').last();
        if ((await pageInput.count()) > 0) {
          try {
            await pageInput.setInputFiles({
              name: file.filename,
              mimeType: file.mimeType,
              buffer: file.buffer,
            });
            attached =
              (await pageInput.evaluate((el) => (el as HTMLInputElement).files?.length ?? 0)) > 0 ||
              (await fileAlreadyUploaded(page.locator("body"), file.filename));
          } catch {
            attached = false;
          }
        }
      }
    }

    if (attached || (await fileAlreadyUploaded(container, file.filename))) {
      filled += 1;
      await page.waitForTimeout(400);
    }
  }

  return filled;
}
