import { toHtmlDateValue } from "@1apply/form-engine";
import { FormPageCaptureSchema } from "@1apply/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Page, Locator } from "playwright";

import type { Actor } from "@/auth/actor";
import { logError } from "@/lib/log";
import { snapToHostOption } from "@/lib/needs-you-field-kinds";
import { persistFormPageCapture } from "@/server/extension/persist-form-page-capture";
import { fillFormPageFromJson } from "@/server/extension/form-fill-from-json";
import { isHostFileUploadEntry, requiredHostFieldsMissing } from "@/server/applications/host-page-fill";

import {
  executeFormDomInPage,
  type CapturedFormPage,
  type FillPlanEntry,
  type FormDomAction,
} from "./playwright-form-dom";
import { applyHostFileUploads } from "./playwright-host-files";
import { findHostFieldScope } from "./playwright-host-scope";
import { loadDocumentVersionUpload, type DocumentVersionUpload } from "@/server/documents/download-version";

const MAX_STEPS = 14;
const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

async function evaluateFormDom<T>(
  page: Page,
  action: FormDomAction,
  arg?: FillPlanEntry[],
): Promise<T> {
  // Pass the self-contained function directly — never toString/new Function helpers.
  return page.evaluate(executeFormDomInPage, { action, arg }) as Promise<T>;
}

export type ServerHostSubmitResult =
  | { ok: true; submitted: boolean; hostSubmitClicked: boolean; filledFields: number }
  | {
      ok: true;
      submitted: false;
      hostSubmitClicked: false;
      filledFields: number;
      pausedForNeedsYou: true;
      missingRequired: string[];
    }
  | { ok: false; blockedReason: string; error?: string; hostSubmitClicked?: boolean }
  | { ok: false; error: string; blockedReason?: string; hostSubmitClicked?: boolean };

async function waitForPageReady(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 45_000 }).catch(() => undefined);
  await page
    .locator('[role="listitem"], input:not([type=hidden]), textarea, [role="radio"], [role="checkbox"]')
    .first()
    .waitFor({ state: "visible", timeout: 12_000 })
    .catch(() => undefined);
  // Google Forms questions often paint after the first listitem shell.
  await page.waitForTimeout(1_200);
}

/** Open each dropdown so capture can record real options (they live in a portal while closed). */
async function harvestGoogleListboxOptions(page: Page): Promise<void> {
  const items = page.locator('[role="listitem"]');
  const count = await items.count();
  for (let i = 0; i < count; i += 1) {
    const item = items.nth(i);
    const listbox = item.getByRole("listbox").first();
    if ((await listbox.count()) === 0) continue;
    await listbox.scrollIntoViewIfNeeded().catch(() => undefined);
    await listbox.click({ timeout: 2_000 }).catch(() => undefined);
    await page.getByRole("option").first().waitFor({ state: "visible", timeout: 2_500 }).catch(() => undefined);
    const options = page.getByRole("option");
    const n = await options.count();
    const labels: string[] = [];
    for (let j = 0; j < Math.min(n, 40); j += 1) {
      const text = ((await options.nth(j).innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      if (text && !/^(choose|select|pick)\b/i.test(text) && text.length <= 200) labels.push(text);
    }
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(120);
    if (labels.length > 0) {
      await item
        .evaluate((el, next) => el.setAttribute("data-1apply-options", JSON.stringify(next)), labels)
        .catch(() => undefined);
    }
  }
}

async function waitForHostConfirmation(page: Page): Promise<boolean> {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    await page.waitForLoadState("domcontentloaded", { timeout: 2_000 }).catch(() => undefined);
    if (await evaluateFormDom<boolean>(page, "confirm")) return true;
    // Google Forms often lands on formResponse URL after a real submit.
    const href = page.url().toLowerCase();
    if (/formresponse/.test(href) && !/viewform|editform/.test(href)) return true;
    await page.waitForTimeout(700);
  }
  return evaluateFormDom<boolean>(page, "confirm");
}

async function clickFirstVisibleLocator(candidates: Locator[]): Promise<boolean> {
  for (const locator of candidates) {
    try {
      if ((await locator.count()) === 0) continue;
      if (!(await locator.isVisible())) continue;
      await locator.scrollIntoViewIfNeeded().catch(() => undefined);
      await locator.click({ timeout: 4_000 });
      return true;
    } catch {
      // try next candidate
    }
  }
  return false;
}

/** Prefer Playwright pointer click — Google Forms often ignores a bare DOM .click(). */
async function clickHostSubmitWithPlaywright(page: Page): Promise<boolean> {
  return clickFirstVisibleLocator([
    page.locator('div[role="button"][jsname="M2UYVd"]').first(),
    page.locator(".freebirdFormviewerViewNavigationSubmitButton").first(),
    page.locator('[data-action-id="submit"]').first(),
    page.getByRole("button", { name: /^(submit|send)$/i }).first(),
    page.locator('button[type="submit"]').first(),
  ]);
}

async function clickHostNextWithPlaywright(page: Page): Promise<boolean> {
  return clickFirstVisibleLocator([
    page.locator('div[role="button"][jsname="OCpkoe"]').first(),
    page.locator(".freebirdFormviewerViewNavigationNextButton").first(),
    page.getByRole("button", { name: /^(next|continue|proceed)$/i }).first(),
    page.locator('[aria-label="Next"]').first(),
    page.locator('[aria-label="Continue"]').first(),
  ]);
}

/** Escape a string for use in a `RegExp` constructor. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function locatorIsChecked(locator: Locator): Promise<boolean> {
  const selected = ((await locator.getAttribute("aria-selected").catch(() => null)) ?? "").toLowerCase();
  if (selected === "true") return true;
  const aria = ((await locator.getAttribute("aria-checked").catch(() => null)) ?? "").toLowerCase();
  if (aria === "true") return true;
  try {
    if (await locator.isChecked({ timeout: 400 })) return true;
  } catch {
    // not a native checkbox/radio
  }
  return false;
}

async function clickAndConfirmChoice(locator: Locator): Promise<boolean> {
  const first = locator.first();
  if ((await first.count()) === 0) return false;
  await first.scrollIntoViewIfNeeded().catch(() => undefined);
  await first.click({ timeout: 3_000 }).catch(() => first.click({ timeout: 2_000, force: true }));
  await first.page().waitForTimeout(140);
  const toggle = first
    .locator("xpath=ancestor-or-self::*[@role='radio' or @role='checkbox' or @role='option' or @aria-checked or @aria-selected][1]")
    .first();
  const target = (await toggle.count()) > 0 ? toggle : first;
  if (await locatorIsChecked(target)) return true;
  const label = first.locator(".aDTYNe, .docssharedWizToggleLabeledLabelText, .ulDsOb, .Od2TWd").first();
  if ((await label.count()) > 0) {
    await label.click({ timeout: 2_000, force: true }).catch(() => undefined);
    await first.page().waitForTimeout(140);
  }
  return locatorIsChecked(target) || locatorIsChecked(first);
}

async function listboxShowsValue(scope: Locator, value: string): Promise<boolean> {
  const shown = ((await scope.getByRole("listbox").innerText().catch(() => "")) || "").trim().toLowerCase();
  const need = value.trim().toLowerCase();
  if (!need || !shown) return false;
  if (/^(choose|select|pick)\b/i.test(shown)) return false;
  return shown.includes(need);
}

/** Click radios / selects from saved headless memory — Google Forms often ignores DOM-only clicks. */
async function clickGoogleChoice(
  page: Page,
  scope: Locator,
  type: string | undefined,
  value: string,
): Promise<boolean> {
  const exact = new RegExp(`^\\s*${escapeRegExp(value)}\\s*$`, "i");
  const fuzzy = new RegExp(`^\\s*${escapeRegExp(value)}`, "i");

  if (type === "select") {
    const native = scope.locator("select").first();
    if ((await native.count()) > 0) {
      try {
        await native.selectOption({ label: value }, { timeout: 2_000 });
        return true;
      } catch {
        await native.selectOption({ value }).catch(() => undefined);
        const selected = await native.inputValue().catch(() => "");
        if (selected && selected.toLowerCase() === value.toLowerCase()) return true;
      }
    }
    const listbox = scope.getByRole("listbox").first();
    if ((await listbox.count()) > 0) {
      await listbox.scrollIntoViewIfNeeded().catch(() => undefined);
      await listbox.click({ timeout: 3_000 }).catch(() => undefined);
      const optionVisible = page.getByRole("option").first();
      await optionVisible.waitFor({ state: "visible", timeout: 4_000 }).catch(() => undefined);
      if ((await optionVisible.count()) === 0) {
        await listbox.locator(".vRMGwf, .MocG8c, .eBLNLd").first().click({ timeout: 2_000 }).catch(() => undefined);
        await optionVisible.waitFor({ state: "visible", timeout: 3_000 }).catch(() => undefined);
      }
      const option = page.getByRole("option", { name: exact }).first();
      const fallback = page.getByRole("option", { name: fuzzy }).first();
      const pick = (await option.count()) > 0 ? option : fallback;
      if ((await pick.count()) > 0) {
        await pick.click({ timeout: 3_000 }).catch(() => undefined);
        await page.waitForTimeout(150);
        if (await listboxShowsValue(scope, value)) return true;
      }
      await page.keyboard.type(value, { delay: 18 });
      await page.keyboard.press("Enter").catch(() => undefined);
      await page.waitForTimeout(150);
      if (await listboxShowsValue(scope, value)) return true;
    }
  }

  if (type === "checkbox") {
    const boxes = scope.getByRole("checkbox");
    if ((await boxes.count()) === 1 && /^(yes|true|1|checked|on|confirm)$/i.test(value.trim())) {
      const box = boxes.first();
      if (await locatorIsChecked(box)) return true;
      return clickAndConfirmChoice(box);
    }
  }

  const role = type === "checkbox" ? "checkbox" : type === "select" ? "option" : "radio";
  const labelHit = scope
    .locator(".docssharedWizToggleLabeledLabelText, .ulDsOb, .aDTYNe, .Od2TWd")
    .filter({ hasText: exact });
  const candidates: Locator[] = [
    labelHit,
    scope.getByRole(role, { name: exact }),
    scope.locator(`[role="${role}"][data-value="${value}"]`),
    scope.locator(`[role="${role}"][aria-label="${value}"]`),
    scope.getByRole(role, { name: fuzzy }),
  ];
  if (type === "select") {
    candidates.unshift(page.getByRole("option", { name: exact }), page.getByRole("option", { name: fuzzy }));
  }

  for (const locator of candidates) {
    try {
      if (await clickAndConfirmChoice(locator)) return true;
      if (type === "select" && (await listboxShowsValue(scope, value))) return true;
    } catch {
      // try next candidate
    }
  }
  return false;
}

function splitCheckboxValues(value: string, options?: string[]): string[] {
  const byLine = value
    .split(/\n|;/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (byLine.length > 1) return byLine;
  if (options && options.length > 0) {
    const lower = value.toLowerCase();
    const hits = options.filter((option) => option.trim() && lower.includes(option.trim().toLowerCase()));
    if (hits.length > 0) return hits;
  }
  return [value.trim()];
}

async function fillChoiceEntriesWithPlaywright(page: Page, entries: FillPlanEntry[]): Promise<number> {
  let filled = 0;
  for (const entry of entries) {
    if (entry.status !== "filled") continue;
    if (isHostFileUploadEntry(entry)) continue;
    const value = entry.value?.trim() ?? "";
    if (!value) continue;
    const scope = await findHostFieldScope(page, entry);
    if (!scope) continue;
    const type = entry.type;
    const inferred =
      type === "radio" || type === "select" || type === "checkbox"
        ? type
        : (await scope.locator('[role="radio"], input[type="radio"]').count()) > 0
          ? "radio"
          : (await scope.locator('[role="listbox"], select').count()) > 0
            ? "select"
            : (await scope.locator('[role="checkbox"], input[type="checkbox"]').count()) > 0
              ? "checkbox"
              : null;
    if (!inferred || (inferred !== "radio" && inferred !== "select" && inferred !== "checkbox")) continue;
    const parts = inferred === "checkbox" ? splitCheckboxValues(value, entry.options) : [value];
    try {
      let ok = false;
      for (const part of parts) {
        if (await clickGoogleChoice(page, scope, inferred, part)) ok = true;
      }
      if (ok) filled += 1;
    } catch {
      // leave for in-page apply / validation
    }
  }
  return filled;
}

const GOOGLE_TEXT_CONTROL =
  'input.whsOnd, textarea.whsOnd, input[jsname="YPqjbf"], textarea[jsname="YPqjbf"], [contenteditable="true"], input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox]):not([type=button]):not([type=submit]), textarea';

function valuesMatch(current: string, wanted: string): boolean {
  const have = current.replace(/\s+/g, " ").trim().toLowerCase();
  const need = wanted.replace(/\s+/g, " ").trim().toLowerCase();
  if (!need) return Boolean(have);
  if (have === need) return true;
  if (have.includes(need) || need.includes(have)) return have.length > 0;
  return false;
}

async function readControlValue(control: Locator): Promise<string> {
  const value = await control.inputValue().catch(() => "");
  if (value.trim()) return value;
  return ((await control.textContent().catch(() => "")) ?? "").trim();
}

async function typeIntoHostControl(page: Page, control: Locator, value: string): Promise<boolean> {
  await control.scrollIntoViewIfNeeded().catch(() => undefined);
  await control.click({ timeout: 3_000 }).catch(() => control.click({ timeout: 2_000, force: true }));
  await page.waitForTimeout(80);
  const focused = await control
    .evaluate((el) => {
      const active = document.activeElement;
      return el === active || Boolean(active && el.contains(active));
    })
    .catch(() => false);
  if (!focused) await control.focus().catch(() => undefined);
  const canReplace = await control
    .evaluate((el) => {
      const active = document.activeElement;
      return el === active || Boolean(active && el.contains(active));
    })
    .catch(() => false);
  if (canReplace) {
    await page.keyboard.press("Control+A").catch(() => undefined);
    await page.keyboard.press("Backspace").catch(() => undefined);
  }
  const delay = Math.min(22, Math.max(8, Math.floor(360 / Math.max(value.length, 1))));
  await page.keyboard.type(value, { delay });
  await page.keyboard.press("Tab").catch(() => undefined);
  await page.waitForTimeout(80);
  if (valuesMatch(await readControlValue(control), value)) return true;

  await control.click({ timeout: 2_000, force: true }).catch(() => undefined);
  try {
    await control.pressSequentially(value, {
      delay: 12,
      timeout: Math.min(45_000, 2_500 + value.length * 35),
    });
  } catch {
    await control.fill(value, { timeout: 3_000, force: true }).catch(() => undefined);
  }
  await page.keyboard.press("Tab").catch(() => undefined);
  return valuesMatch(await readControlValue(control), value);
}

async function fillDateWithPlaywright(page: Page, scope: Locator, raw: string): Promise<boolean> {
  const iso = toHtmlDateValue(raw);
  if (!iso) return false;
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return false;

  const native = scope.locator('input[type="date"], input[type="datetime-local"], input[type="month"]').first();
  if ((await native.count()) > 0) {
    if (await typeIntoHostControl(page, native, iso)) return true;
    await native.fill(iso, { timeout: 2_000 }).catch(() => undefined);
  }

  const monthName = MONTH_NAMES[Number(month) - 1];
  if (monthName) {
    const monthBox = scope.getByLabel(/month/i).first();
    if ((await monthBox.count()) > 0) {
      await monthBox.click({ timeout: 2_000 }).catch(() => undefined);
      const option = page.getByRole("option", { name: new RegExp(`^\\s*${monthName}\\s*$`, "i") }).first();
      if ((await option.count()) > 0) await option.click({ timeout: 2_000 }).catch(() => undefined);
      else await typeIntoHostControl(page, monthBox, month);
    }
  }

  const dayBox = scope.getByLabel(/day/i).or(scope.locator('input[placeholder="DD"]')).first();
  const yearBox = scope.getByLabel(/year/i).or(scope.locator('input[placeholder="YYYY"]')).first();
  if ((await dayBox.count()) > 0) await typeIntoHostControl(page, dayBox, String(Number(day)));
  if ((await yearBox.count()) > 0) await typeIntoHostControl(page, yearBox, year);

  const inputs = scope.locator(
    'input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox])',
  );
  if ((await inputs.count()) >= 3 && (await dayBox.count()) === 0) {
    await typeIntoHostControl(page, inputs.nth(0), month);
    await typeIntoHostControl(page, inputs.nth(1), day);
    await typeIntoHostControl(page, inputs.nth(2), year);
  }
  const typedInputs = scope.locator(
    'input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox])',
  );
  const count = await typedInputs.count();
  for (let i = 0; i < count; i += 1) {
    const current = await readControlValue(typedInputs.nth(i));
    if (current && (current.includes(year) || current.includes(day) || current.includes(month))) return true;
  }
  return false;
}

async function fillEntriesWithPlaywright(page: Page, entries: FillPlanEntry[]): Promise<number> {
  let filled = 0;
  for (const entry of entries) {
    if (entry.status !== "filled") continue;
    if (isHostFileUploadEntry(entry)) continue;
    const value = entry.value?.trim() ?? "";
    if (!value) continue;
    if (entry.type === "radio" || entry.type === "checkbox" || entry.type === "select") continue;

    const scope = await findHostFieldScope(page, entry);
    if (!scope) continue;

    const looksLikeDate = entry.type === "date" || (await scope.getByLabel(/^month$/i).count()) > 0;
    if (looksLikeDate) {
      if (await fillDateWithPlaywright(page, scope, value)) filled += 1;
      continue;
    }

    const preferred = scope
      .locator('input.whsOnd, textarea.whsOnd, input[jsname="YPqjbf"], textarea[jsname="YPqjbf"]')
      .first();
    const control = (await preferred.count()) > 0 ? preferred : scope.locator(GOOGLE_TEXT_CONTROL).first();
    if ((await control.count()) === 0) continue;
    const answerBox = scope.locator(".Xb9hP, .AgroKb, .Whvsme").first();
    if ((await answerBox.count()) > 0) {
      await answerBox.click({ timeout: 2_000 }).catch(() => undefined);
    }
    if (await typeIntoHostControl(page, control, value)) filled += 1;
  }
  return filled;
}

async function hostEntryLooksFilled(page: Page, entry: FillPlanEntry): Promise<boolean> {
  if (entry.status !== "filled") return true;
  const scope = await findHostFieldScope(page, entry);
  if (!scope) return false;
  if (isHostFileUploadEntry(entry)) {
    const text = ((await scope.innerText().catch(() => "")) || "").toLowerCase();
    if (/uploaded|selected|attached|remove file|1 file/.test(text)) return true;
    const fileInput = scope.locator('input[type="file"]').first();
    if ((await fileInput.count()) > 0) {
      const count = await fileInput
        .evaluate((el) => (el as HTMLInputElement).files?.length ?? 0)
        .catch(() => 0);
      if (count > 0) return true;
    }
    return false;
  }
  const value = entry.value?.trim() ?? "";
  if (
    entry.type === "radio" ||
    entry.type === "checkbox" ||
    entry.type === "select" ||
    (await scope.locator('[role="radio"], [role="checkbox"], [role="listbox"], select').count()) > 0
  ) {
    if ((await scope.locator('[aria-checked="true"], input:checked, [aria-selected="true"]').count()) > 0) {
      return true;
    }
    const listbox = ((await scope.getByRole("listbox").innerText().catch(() => "")) || "").toLowerCase();
    if (value && listbox.includes(value.toLowerCase()) && !/^(choose|select)/i.test(listbox.trim())) return true;
    return false;
  }
  if (!value) return false;
  const preferred = scope
    .locator('input.whsOnd, textarea.whsOnd, input[jsname="YPqjbf"], textarea[jsname="YPqjbf"]')
    .first();
  const control = (await preferred.count()) > 0 ? preferred : scope.locator(GOOGLE_TEXT_CONTROL).first();
  if ((await control.count()) === 0) return false;
  return valuesMatch(await readControlValue(control), value);
}

async function plannedHostFieldsStillEmpty(page: Page, entries: FillPlanEntry[]): Promise<string[]> {
  const planned = entries.filter(
    (entry) => entry.status === "filled" && (Boolean(entry.value?.trim()) || Boolean(entry.documentVersionId)),
  );
  const empty: string[] = [];
  for (const entry of planned) {
    if (!(await hostEntryLooksFilled(page, entry))) empty.push(entry.fieldId);
  }
  return empty;
}

function fillPlanEntriesFromCapture(
  capture: CapturedFormPage,
  plan: {
    fields: Array<{
      fieldId: string;
      status: string;
      value?: string | null;
      documentVersionId?: string | null;
    }>;
  },
): FillPlanEntry[] {
  return plan.fields.map((field) => {
    const captured = capture.fields.find((item) => item.fieldId === field.fieldId);
    const documentVersionId =
      field.documentVersionId ||
      (captured?.type === "file" && field.value && VERSION_ID.test(field.value) ? field.value : undefined);
    const capturedType = captured?.type ?? (documentVersionId ? "file" : undefined);
    const type =
      capturedType === "file" && !documentVersionId && String(field.value ?? "").trim() ? "text" : capturedType;
    let value = documentVersionId ? undefined : field.value ?? undefined;
    if (value && (type === "radio" || type === "checkbox" || type === "select")) {
      value = snapToHostOption(value, captured?.options) ?? value;
    }
    return {
      fieldId: field.fieldId,
      status: field.status === "filled" ? "filled" : "need_you",
      value,
      documentVersionId,
      type,
      label: captured?.label,
      options: captured?.options,
    };
  });
}

async function applyFillPlanToHostPage(input: {
  page: Page;
  supabase: SupabaseClient;
  userId: string;
  entries: FillPlanEntry[];
}): Promise<number> {
  const { page, entries } = input;
  let filled = 0;

  await evaluateFormDom(page, "capture");

  // Playwright pointer/keyboard first — Google Forms ignores in-page value setters.
  filled += await fillEntriesWithPlaywright(page, entries);
  filled += await fillChoiceEntriesWithPlaywright(page, entries);

  const loaded = new Map<string, DocumentVersionUpload>();
  const versionIds = [
    ...new Set(entries.map((entry) => entry.documentVersionId).filter((id): id is string => Boolean(id))),
  ];
  if (versionIds.length > 0) {
    await Promise.all(
      versionIds.slice(0, 20).map(async (versionId) => {
        const upload = await loadDocumentVersionUpload({
          supabase: input.supabase,
          userId: input.userId,
          versionId,
        });
        if (upload) loaded.set(versionId, upload);
      }),
    );
    if (loaded.size > 0) {
      filled += await applyHostFileUploads(page, entries, loaded);
    }
  }

  const stillEmpty = await plannedHostFieldsStillEmpty(page, entries);
  if (stillEmpty.length > 0) {
    const retry = entries.filter((entry) => stillEmpty.includes(entry.fieldId));
    await evaluateFormDom(page, "apply", retry);
    filled += await fillEntriesWithPlaywright(page, retry);
    filled += await fillChoiceEntriesWithPlaywright(page, retry);
    if (loaded.size > 0) {
      filled += await applyHostFileUploads(page, retry, loaded);
    }
  }

  await page.waitForTimeout(400);
  return filled;
}

export async function runPlaywrightHostSubmit(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  sourceUrl: string;
  clickFinalSubmit?: boolean;
}): Promise<ServerHostSubmitResult> {
  return runPlaywrightHostSession({
    ...input,
    clickFinalSubmit: input.clickFinalSubmit ?? true,
  });
}

export async function runPlaywrightHostPrefill(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  sourceUrl: string;
}): Promise<ServerHostSubmitResult> {
  return runPlaywrightHostSession({
    ...input,
    clickFinalSubmit: false,
  });
}

async function runPlaywrightHostSession(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  sourceUrl: string;
  clickFinalSubmit: boolean;
}): Promise<ServerHostSubmitResult> {
  let browser: Awaited<ReturnType<(typeof import("playwright"))["chromium"]["launch"]>> | null = null;

  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(input.sourceUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForPageReady(page);

    let totalFilled = 0;
    let hostSubmitClicked = false;
    let lastNavigationReason = "no-navigation";

    const { data: applicationRow } = await input.supabase
      .from("applications")
      .select("opportunity_id")
      .eq("id", input.applicationId)
      .eq("user_id", input.actor.userId)
      .maybeSingle();
    const opportunityId = applicationRow?.opportunity_id ? String(applicationRow.opportunity_id) : null;

    const toPageCapture = (captured: CapturedFormPage, pageIndex: number) =>
      FormPageCaptureSchema.parse({
        pageIndex,
        origin: new URL(page.url()).origin,
        pageUrl: page.url(),
        hazards: captured.hazards,
        fields: captured.fields.map((field) => ({
          fieldId: field.fieldId,
          fieldKey: field.fieldKey,
          type: field.type,
          label: field.label,
          required: field.required,
          options: field.options,
          currentValue: field.currentValue,
        })),
      });

    for (let step = 0; step < MAX_STEPS; step += 1) {
      await harvestGoogleListboxOptions(page);
      let capture = await evaluateFormDom<CapturedFormPage>(page, "capture");
      if (capture.fields.length === 0) {
        await waitForPageReady(page);
        await harvestGoogleListboxOptions(page);
        capture = await evaluateFormDom<CapturedFormPage>(page, "capture");
      }

      if (capture.hazards.captcha) {
        return { ok: false, blockedReason: "CAPTCHA on this page — complete it manually in the browser." };
      }
      if (capture.hazards.accountCreation) {
        return { ok: false, blockedReason: "This form requires account creation or sign-in." };
      }

      let lastPlanEntries: FillPlanEntry[] = [];

      if (capture.fields.length > 0) {
        const pageCapture = toPageCapture(capture, step);

        if (opportunityId) {
          await persistFormPageCapture(
            input.supabase,
            input.actor.userId,
            input.applicationId,
            opportunityId,
            pageCapture,
          );
        }

        const hostFieldKeyById = Object.fromEntries(
          capture.fields.map((field) => [field.fieldId, field.fieldKey || field.fieldId]),
        );
        const plan = await fillFormPageFromJson({
          supabase: input.supabase,
          actor: input.actor,
          applicationId: input.applicationId,
          page: pageCapture,
          hostFieldKeyById,
        });

        // LLM planning can take long enough for Google Forms to re-render and drop stamps.
        await harvestGoogleListboxOptions(page);
        const recapture = await evaluateFormDom<CapturedFormPage>(page, "capture");
        let liveCapture = recapture.fields.length > 0 ? recapture : capture;
        let livePlan = plan;
        const originalIds = new Set(capture.fields.map((field) => field.fieldId));
        const recaptureHasNewFields = liveCapture.fields.some((field) => !originalIds.has(field.fieldId));
        if (opportunityId && recapture.fields.length > 0) {
          await persistFormPageCapture(
            input.supabase,
            input.actor.userId,
            input.applicationId,
            opportunityId,
            toPageCapture(recapture, step),
          );
        }
        if (recaptureHasNewFields) {
          livePlan = await fillFormPageFromJson({
            supabase: input.supabase,
            actor: input.actor,
            applicationId: input.applicationId,
            page: toPageCapture(liveCapture, step),
            hostFieldKeyById: Object.fromEntries(
              liveCapture.fields.map((field) => [field.fieldId, field.fieldKey || field.fieldId]),
            ),
          });
        }
        capture = liveCapture;

        const entries = fillPlanEntriesFromCapture(liveCapture, livePlan);
        lastPlanEntries = entries;
        totalFilled += await applyFillPlanToHostPage({
          page,
          supabase: input.supabase,
          userId: input.actor.userId,
          entries,
        });

        const missingRequired = requiredHostFieldsMissing(liveCapture.fields, livePlan.fields);
        if (missingRequired.length > 0) {
          await context.close();
          return {
            ok: true,
            submitted: false,
            hostSubmitClicked: false,
            filledFields: totalFilled,
            pausedForNeedsYou: true,
            missingRequired,
          };
        }

        const requiredEmptyOnHost = async () => {
          const requiredIds = new Set(
            liveCapture.fields.filter((field) => field.required).map((field) => field.fieldId),
          );
          const empty = await plannedHostFieldsStillEmpty(page, entries);
          return empty.filter((id) => requiredIds.has(id));
        };
        let blockedIds = await requiredEmptyOnHost();
        if (blockedIds.length > 0) {
          totalFilled += await applyFillPlanToHostPage({
            page,
            supabase: input.supabase,
            userId: input.actor.userId,
            entries: entries.filter((entry) => blockedIds.includes(entry.fieldId)),
          });
          blockedIds = await requiredEmptyOnHost();
        }
        if (blockedIds.length > 0) {
          const labels = liveCapture.fields
            .filter((field) => blockedIds.includes(field.fieldId))
            .map((field) => field.label.trim() || field.fieldId);
          await context.close();
          return {
            ok: false,
            error: `Required host questions are still empty after fill, so Next/Submit would be rejected: ${labels.join("; ")}`,
          };
        }
      }

      const previousUrl = page.url();
      const previousText = capture.pageText.slice(0, 200);
      const pageUnchanged = async () =>
        page.url() === previousUrl &&
        (await evaluateFormDom<CapturedFormPage>(page, "capture")).pageText.slice(0, 200) === previousText;

      let advanced = await clickHostNextWithPlaywright(page);
      if (advanced) {
        lastNavigationReason = "next-clicked-playwright";
      } else {
        const advance = await evaluateFormDom<{ clicked: boolean; reason?: string }>(page, "next");
        advanced = advance.clicked;
        lastNavigationReason = advance.reason ?? (advance.clicked ? "next-clicked" : "no-next");
      }

      if (advanced) {
        await waitForPageReady(page);
        if (!(await pageUnchanged())) {
          continue;
        }
        lastNavigationReason = "next-stuck";
        if (lastPlanEntries.length > 0) {
          totalFilled += await applyFillPlanToHostPage({
            page,
            supabase: input.supabase,
            userId: input.actor.userId,
            entries: lastPlanEntries,
          });
          const retried =
            (await clickHostNextWithPlaywright(page)) ||
            (await evaluateFormDom<{ clicked: boolean }>(page, "next")).clicked;
          if (retried) {
            await waitForPageReady(page);
            if (!(await pageUnchanged())) continue;
          }
        }
      }

      if (input.clickFinalSubmit) {
        // Prefer Playwright pointer click for Google Forms; fall back to in-page .click().
        let submitClicked = await clickHostSubmitWithPlaywright(page);
        if (!submitClicked) {
          const submit = await evaluateFormDom<{ clicked: boolean; reason?: string }>(page, "submit");
          submitClicked = submit.clicked;
          lastNavigationReason = submit.reason ?? (submit.clicked ? "submit-clicked" : "no-submit");
        } else {
          lastNavigationReason = "submit-clicked-playwright";
        }

        if (submitClicked) {
          hostSubmitClicked = true;
          let confirmed = await waitForHostConfirmation(page);
          if (!confirmed && !(await evaluateFormDom<boolean>(page, "validation"))) {
            // One retry — first click sometimes only focuses the control.
            const retried = await clickHostSubmitWithPlaywright(page);
            if (retried) confirmed = await waitForHostConfirmation(page);
          }
          if (confirmed) {
            await context.close();
            return {
              ok: true,
              submitted: true,
              hostSubmitClicked: true,
              filledFields: totalFilled,
            };
          }

          const validationBlocked = await evaluateFormDom<boolean>(page, "validation");
          await context.close();
          return {
            ok: false,
            error: validationBlocked
              ? "Submit was clicked but required fields are still empty on the host form."
              : "Submit was clicked but the host did not confirm the response. Open the form and submit manually.",
            hostSubmitClicked: true,
          };
        }
      } else if (capture.hazards.hasSubmitControl) {
        await context.close();
        return {
          ok: true,
          submitted: false,
          hostSubmitClicked: false,
          filledFields: totalFilled,
        };
      }

      if (capture.fields.length === 0 && !capture.hazards.hasSubmitControl) {
        return { ok: false, error: "No fillable fields found on this page." };
      }

      break;
    }

    if (hostSubmitClicked) {
      // Click without confirmation is not success — returned as ok:false above when possible.
      return {
        ok: false,
        error: "Submit was clicked but the host did not confirm the response.",
        hostSubmitClicked: true,
      };
    }

    if (!input.clickFinalSubmit && totalFilled > 0) {
      return {
        ok: true,
        submitted: false,
        hostSubmitClicked: false,
        filledFields: totalFilled,
      };
    }

    return {
      ok: false,
      error: input.clickFinalSubmit
        ? `Could not reach Submit — some fields may still need answers in Need You. (${lastNavigationReason})`
        : "Could not prefill this form.",
    };
  } catch (err) {
    logError("playwright.host_submit_failed", { err, applicationId: input.applicationId });
    if (err && typeof err === "object" && "issues" in err && Array.isArray((err as { issues: unknown[] }).issues)) {
      const issues = (err as { issues: Array<{ path?: (string | number)[]; message?: string; code?: string }> }).issues;
      const summary = issues
        .slice(0, 3)
        .map((issue) => `${(issue.path ?? []).join(".") || "field"}: ${issue.message ?? issue.code ?? "invalid"}`)
        .join("; ");
      return { ok: false, error: `Form capture validation failed (${summary}).` };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "playwright_host_submit_failed",
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

export function isServerHostSubmitEnabled(): boolean {
  const flag = process.env.ENABLE_SERVER_HOST_SUBMIT?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") {
    logError("host_submit.server_disabled", {
      hint: "ENABLE_SERVER_HOST_SUBMIT is off — host fill/submit will not run. Extension cannot replace it.",
    });
    return false;
  }
  return true;
}
