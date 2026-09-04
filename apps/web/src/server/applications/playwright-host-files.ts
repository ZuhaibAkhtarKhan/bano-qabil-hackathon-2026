import type { Page, Frame, Locator } from "playwright";

import type { DocumentVersionUpload } from "@/server/documents/download-version";

import type { FillPlanEntry } from "./playwright-form-dom";
import { findHostFieldScope } from "./playwright-host-scope";

function basename(filename: string): string {
  return filename.trim().toLowerCase().replace(/^.*[\\/]/, "");
}

async function fileAlreadyUploaded(scope: Locator, filename: string): Promise<boolean> {
  const wanted = basename(filename);
  if (!wanted) return false;

  const inputCount = await scope.locator('input[type="file"]').count();
  for (let i = 0; i < inputCount; i += 1) {
    const files = await scope
      .locator('input[type="file"]')
      .nth(i)
      .evaluate((el) => Array.from((el as HTMLInputElement).files ?? []).map((item) => item.name.toLowerCase()));
    if (files.some((name) => name === wanted || name.endsWith(wanted))) return true;
  }

  const text = ((await scope.innerText().catch(() => "")) || "").toLowerCase();
  if (text.includes(wanted) && /uploaded|selected|attached|remove file|1 file/i.test(text)) return true;
  return false;
}

async function setFilesOnFrame(frame: Frame, file: DocumentVersionUpload): Promise<boolean> {
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

async function attachViaChooser(
  page: Page,
  clickTarget: Locator,
  file: DocumentVersionUpload,
  timeoutMs = 2_500,
): Promise<boolean> {
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: timeoutMs }),
      clickTarget.click({ timeout: timeoutMs }),
    ]);
    await chooser.setFiles({
      name: file.filename,
      mimeType: file.mimeType,
      buffer: file.buffer,
    });
    return true;
  } catch {
    return false;
  }
}

async function clickVisibleInFrames(
  page: Page,
  find: (root: Page | Frame) => Locator,
): Promise<boolean> {
  const roots: Array<Page | Frame> = [page, ...page.frames()];
  for (const root of roots) {
    const locator = find(root).first();
    try {
      if ((await locator.count()) === 0) continue;
      if (!(await locator.isVisible().catch(() => false))) continue;
      await locator.click({ timeout: 3_000 });
      return true;
    } catch {
      // try next frame
    }
  }
  return false;
}

/** Google Forms file questions open Drive picker; the OS chooser only appears on the Upload tab. */
async function completeGoogleDrivePicker(page: Page, file: DocumentVersionUpload): Promise<boolean> {
  await page.waitForTimeout(500);
  await clickVisibleInFrames(page, (root) =>
    root.getByRole("tab", { name: /upload/i }).or(root.locator('[role="tab"]').filter({ hasText: /^upload$/i })),
  );
  await page.waitForTimeout(350);

  const browseFinders: Array<(root: Page | Frame) => Locator> = [
    (root) => root.getByRole("button", { name: /browse|select files from your device/i }),
    (root) => root.locator("button, [role='button']").filter({ hasText: /^(browse|select files from your device)$/i }),
    (root) => root.locator('input[type="file"]'),
  ];

  for (const find of browseFinders) {
    const roots: Array<Page | Frame> = [page, ...page.frames()];
    for (const root of roots) {
      const target = find(root).first();
      if ((await target.count()) === 0) continue;
      const attached = await attachViaChooser(page, target, file, 6_000);
      if (attached) {
        await page.waitForTimeout(600);
        await page.keyboard.press("Escape").catch(() => undefined);
        return true;
      }
      if (root !== page) {
        try {
          await target.setInputFiles({
            name: file.filename,
            mimeType: file.mimeType,
            buffer: file.buffer,
          });
          await page.waitForTimeout(600);
          return true;
        } catch {
          // keep looking
        }
      }
    }
  }

  for (const frame of page.frames()) {
    if (await setFilesOnFrame(frame, file)) {
      await page.keyboard.press("Escape").catch(() => undefined);
      return true;
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
    if (entry.status !== "filled") continue;
    const versionId = entry.documentVersionId;
    if (!versionId) continue;
    if (entry.type && entry.type !== "file") continue;
    const file = files.get(versionId);
    if (!file) continue;

    const container = (await findHostFieldScope(page, entry)) ?? page.locator("body");
    if (await fileAlreadyUploaded(container, file.filename)) {
      filled += 1;
      continue;
    }

    let attached = false;
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
        attached = await attachViaChooser(page, scopedInput, file, 2_500);
      }
    }

    const addBtn = container.locator('button, [role="button"], span[role="link"], a').filter({
      hasText: /add file|upload file|browse|choose file|attach|upload/i,
    });
    if (!attached && (await addBtn.count()) > 0) {
      const chooserOpened = page.waitForEvent("filechooser", { timeout: 1_800 }).catch(() => null);
      await addBtn.first().click({ timeout: 4_000 }).catch(() => undefined);
      const chooser = await chooserOpened;
      if (chooser) {
        await chooser.setFiles({
          name: file.filename,
          mimeType: file.mimeType,
          buffer: file.buffer,
        });
        attached = true;
      } else {
        attached = await completeGoogleDrivePicker(page, file);
      }
    }

    if (!attached) {
      attached = await completeGoogleDrivePicker(page, file);
    }

    if (!attached) {
      for (const frame of page.frames()) {
        if (await setFilesOnFrame(frame, file)) {
          attached = true;
          break;
        }
      }
    }

    if (attached || (await fileAlreadyUploaded(container, file.filename)) || (await fileAlreadyUploaded(page.locator("body"), file.filename))) {
      filled += 1;
      await page.waitForTimeout(400);
    } else {
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  }

  return filled;
}
