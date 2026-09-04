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

/**
 * Playwright's locator.fill() updates React/Google Forms state more reliably than
 * DOM property setters alone. Used after (or instead of) in-page apply.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Click radios / selects from saved headless memory — Google Forms often ignores DOM-only clicks. */
async function clickGoogleChoice(
  page: Page,
  scope: Locator,
  type: string | undefined,
  value: string,
): Promise<boolean> {
  const exact = new RegExp(`^\\s*${escapeRegExp(value)}\\s*$`, "i");
  const fuzzy = new RegExp(escapeRegExp(value), "i");

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
      await page.waitForTimeout(200);
    }
  }

  const role = type === "checkbox" ? "checkbox" : type === "select" ? "option" : "radio";
  const candidates: Locator[] = [
    scope.getByRole(role, { name: exact }),
    scope.getByLabel(exact),
    scope.locator(`[data-value="${value}"]`),
    scope.locator(`[aria-label="${value}"]`),
    scope.locator(".docssharedWizToggleLabeledLabelText, .ulDsOb, .aDTYNe, .Od2TWd").filter({ hasText: exact }),
    scope.getByText(exact),
    scope.getByRole(role, { name: fuzzy }),
    scope.locator(".docssharedWizToggleLabeledLabelText, .ulDsOb, .aDTYNe, .Od2TWd").filter({ hasText: fuzzy }),
    scope.getByText(fuzzy),
  ];
  if (type === "select") {
    candidates.unshift(page.getByRole("option", { name: exact }), page.getByRole("option", { name: fuzzy }));
  }

  for (const locator of candidates) {
    try {
      const first = locator.first();
      if ((await first.count()) === 0) continue;
      await first.scrollIntoViewIfNeeded().catch(() => undefined);
      await first.click({ timeout: 3_000 });
      return true;
    } catch {
      // try next candidate
    }
  }
  return false;
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
    const parts =
      inferred === "checkbox"
        ? value.split(/\n|;/).map((part) => part.trim()).filter(Boolean)
        : [value];
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

async function fillDateWithPlaywright(page: Page, scope: Locator, raw: string): Promise<boolean> {
  const iso = toHtmlDateValue(raw);
  if (!iso) return false;
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return false;

  const native = scope.locator('input[type="date"], input[type="datetime-local"], input[type="month"]').first();
  if ((await native.count()) > 0) {
    try {
      await native.fill(iso, { timeout: 4_000 });
      return true;
    } catch {
      await native.fill(`${year}-${month}`, { timeout: 2_000 }).catch(() => undefined);
    }
  }

  const monthName = MONTH_NAMES[Number(month) - 1];
  if (monthName) {
    const monthBox = scope.getByLabel(/month/i).first();
    if ((await monthBox.count()) > 0) {
      await monthBox.click({ timeout: 2_000 }).catch(() => undefined);
      const option = page.getByRole("option", { name: new RegExp(`^\\s*${monthName}\\s*$`, "i") }).first();
      if ((await option.count()) > 0) await option.click({ timeout: 2_000 }).catch(() => undefined);
      else await monthBox.fill(month, { timeout: 2_000 }).catch(() => undefined);
    }
  }

  const dayBox = scope.getByLabel(/^day$/i).or(scope.locator('input[placeholder="DD"]')).first();
  const yearBox = scope.getByLabel(/^year$/i).or(scope.locator('input[placeholder="YYYY"]')).first();
  if ((await dayBox.count()) > 0) await dayBox.fill(String(Number(day)), { timeout: 2_000 }).catch(() => undefined);
  if ((await yearBox.count()) > 0) await yearBox.fill(year, { timeout: 2_000 }).catch(() => undefined);

  const inputs = scope.locator(
    'input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox]), [role="textbox"]',
  );
  if ((await inputs.count()) >= 3 && (await dayBox.count()) === 0) {
    await inputs.nth(0).fill(month, { timeout: 2_000 }).catch(() => undefined);
    await inputs.nth(1).fill(day, { timeout: 2_000 }).catch(() => undefined);
    await inputs.nth(2).fill(year, { timeout: 2_000 }).catch(() => undefined);
  }
  return true;
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

    if (entry.type === "date") {
      if (await fillDateWithPlaywright(page, scope, value)) filled += 1;
      continue;
    }

    const control = scope
      .locator(
        'input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox]), textarea, [contenteditable="true"], [role="textbox"]',
      )
      .first();
    if ((await control.count()) === 0) continue;

    try {
      await control.scrollIntoViewIfNeeded().catch(() => undefined);
      await control.click({ timeout: 2_000 }).catch(() => undefined);
      await control.fill(value, { timeout: 4_000 });
      // Some Google Forms widgets need an Enter/Tab to commit.
      await control.press("Tab").catch(() => undefined);
      filled += 1;
    } catch {
      try {
        await control.evaluate((node, nextValue) => {
          const el = node as HTMLInputElement | HTMLTextAreaElement | HTMLElement;
          el.focus();
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            const proto =
              el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, nextValue);
            if (el.value !== nextValue) el.value = nextValue;
          } else {
            el.textContent = nextValue;
          }
          el.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              cancelable: true,
              composed: true,
              inputType: "insertFromPaste",
              data: nextValue,
            }),
          );
          el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
          el.blur();
        }, value);
        filled += 1;
      } catch {
        // leave for validation gate
      }
    }
  }
  return filled;
}

async function plannedTextStillEmpty(page: Page, entries: FillPlanEntry[]): Promise<string[]> {
  const planned = entries.filter(
    (entry) =>
      entry.status === "filled" &&
      Boolean(entry.value?.trim()) &&
      entry.type !== "file" &&
      entry.type !== "radio" &&
      entry.type !== "checkbox" &&
      entry.type !== "select" &&
      !isHostFileUploadEntry(entry),
  );
  if (planned.length === 0) return [];
  const reads = await evaluateFormDom<Array<{ fieldId: string; value: string; empty: boolean }>>(
    page,
    "read",
    planned,
  );
  const emptyIds = new Set(reads.filter((row) => row.empty).map((row) => row.fieldId));
  return planned.filter((entry) => emptyIds.has(entry.fieldId)).map((entry) => entry.fieldId);
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

  const applyResult = await evaluateFormDom<{ filled: number; skipped: number }>(page, "apply", entries);
  filled += applyResult.filled;

  filled += await fillEntriesWithPlaywright(page, entries);
  filled += await fillChoiceEntriesWithPlaywright(page, entries);

  const choiceEntries = entries.filter(
    (entry) =>
      entry.status === "filled" &&
      Boolean(entry.value?.trim()) &&
      (entry.type === "radio" || entry.type === "select" || entry.type === "checkbox"),
  );
  if (choiceEntries.length > 0) {
    const choiceReads = await evaluateFormDom<Array<{ fieldId: string; value: string; empty: boolean }>>(
      page,
      "read",
      choiceEntries,
    );
    const stillOpen = new Set((choiceReads ?? []).filter((row) => row.empty).map((row) => row.fieldId));
    if (stillOpen.size > 0) {
      const retry = choiceEntries.filter((entry) => stillOpen.has(entry.fieldId));
      await evaluateFormDom(page, "apply", retry);
      filled += await fillChoiceEntriesWithPlaywright(page, retry);
    }
  }

  let stillEmpty = await plannedTextStillEmpty(page, entries);
  if (stillEmpty.length > 0) {
    await evaluateFormDom(
      page,
      "apply",
      entries.filter((entry) => stillEmpty.includes(entry.fieldId)),
    );
    await fillEntriesWithPlaywright(
      page,
      entries.filter((entry) => stillEmpty.includes(entry.fieldId)),
    );
    stillEmpty = await plannedTextStillEmpty(page, entries);
  }

  const versionIds = [
    ...new Set(entries.map((entry) => entry.documentVersionId).filter((id): id is string => Boolean(id))),
  ];
  if (versionIds.length > 0) {
    const loaded = new Map<string, DocumentVersionUpload>();
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

  await page.waitForTimeout(600);
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
      let capture = await evaluateFormDom<CapturedFormPage>(page, "capture");
      if (capture.fields.length === 0) {
        await waitForPageReady(page);
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
