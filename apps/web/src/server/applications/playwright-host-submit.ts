import { FormPageCaptureSchema } from "@1apply/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "playwright";

import type { Actor } from "@/auth/actor";
import { logError } from "@/lib/log";
import { fillFormPageFromJson } from "@/server/extension/form-fill-from-json";

import {
  formDomBrowserBundle,
  type CapturedFormPage,
  type FillPlanEntry,
  type FormDomAction,
} from "./playwright-form-dom";
import { applyHostFileUploads } from "./playwright-host-files";
import { loadDocumentVersionUpload, type DocumentVersionUpload } from "@/server/documents/download-version";

const MAX_STEPS = 14;
const STEP_WAIT_MS = 1800;
const FORM_DOM_BUNDLE = formDomBrowserBundle();

async function evaluateFormDom<T>(
  page: Page,
  action: FormDomAction,
  arg?: FillPlanEntry[],
): Promise<T> {
  return page.evaluate(
    ({ bootstrap, action: nextAction, arg: nextArg }) => {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const run = new Function(
        `${bootstrap}\nreturn (function(action, arg) {\n  if (action === "capture") return captureFormPage();\n  if (action === "apply") return applyFillPlan(arg || []);\n  if (action === "next") return clickNextControl();\n  if (action === "submit") return clickSubmitControl();\n  if (action === "confirm") return detectSubmissionConfirmation();\n  throw new Error("unknown_form_dom_action");\n});`,
      ) as () => (action: FormDomAction, arg?: FillPlanEntry[]) => T;
      return run()(nextAction as FormDomAction, nextArg as FillPlanEntry[] | undefined);
    },
    { bootstrap: FORM_DOM_BUNDLE, action, arg },
  );
}

export type ServerHostSubmitResult =
  | { ok: true; submitted: boolean; hostSubmitClicked: boolean; filledFields: number }
  | { ok: false; blockedReason: string; error?: string }
  | { ok: false; error: string; blockedReason?: string };

async function waitForPageReady(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 45_000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
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

    for (let step = 0; step < MAX_STEPS; step += 1) {
      const capture = (await evaluateFormDom<CapturedFormPage>(page, "capture"));

      if (capture.hazards.captcha) {
        return { ok: false, blockedReason: "CAPTCHA on this page — complete it manually in the browser." };
      }
      if (capture.hazards.accountCreation) {
        return { ok: false, blockedReason: "This form requires account creation or sign-in." };
      }

      if (capture.fields.length > 0) {
        const origin = new URL(page.url()).origin;
        const pageCapture = FormPageCaptureSchema.parse({
          pageIndex: step,
          origin,
          pageUrl: page.url(),
          hazards: capture.hazards,
          fields: capture.fields.map((field) => ({
            fieldId: field.fieldId,
            fieldKey: field.fieldKey,
            type: field.type,
            label: field.label,
            required: field.required,
            options: field.options,
            currentValue: field.currentValue,
          })),
        });

        const plan = await fillFormPageFromJson({
          supabase: input.supabase,
          actor: input.actor,
          applicationId: input.applicationId,
          page: pageCapture,
        });

        const entries: FillPlanEntry[] = plan.fields.map((field) => ({
          fieldId: field.fieldId,
          status: field.status,
          value: field.value,
          documentVersionId: field.documentVersionId,
          type: capture.fields.find((item) => item.fieldId === field.fieldId)?.type,
        }));

        const applyResult = (await evaluateFormDom<{ filled: number; skipped: number }>(
          page,
          "apply",
          entries,
        ));
        totalFilled += applyResult.filled;

        const versionIds = [
          ...new Set(
            entries
              .map((entry) => entry.documentVersionId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        if (versionIds.length > 0) {
          const loaded = new Map<string, DocumentVersionUpload>();
          await Promise.all(
            versionIds.slice(0, 6).map(async (versionId) => {
              const upload = await loadDocumentVersionUpload({
                supabase: input.supabase,
                userId: input.actor.userId,
                versionId,
              });
              if (upload) loaded.set(versionId, upload);
            }),
          );
          if (loaded.size > 0) {
            totalFilled += await applyHostFileUploads(page, entries, loaded);
          }
        }

        await page.waitForTimeout(600);
      }

      const advance = await evaluateFormDom<{ clicked: boolean; reason?: string }>(page, "next");
      lastNavigationReason = advance.reason ?? (advance.clicked ? "next-clicked" : "no-next");
      if (advance.clicked) {
        const previousUrl = page.url();
        const previousText = capture.pageText.slice(0, 200);
        await waitForPageReady(page);
        const stillSamePage =
          page.url() === previousUrl &&
          ((await evaluateFormDom<CapturedFormPage>(page, "capture")).pageText.slice(0, 200) === previousText);
        if (!stillSamePage) {
          continue;
        }
        // Next didn't advance (often required-field validation) — fall through to Submit.
        lastNavigationReason = "next-stuck";
      }

      if (input.clickFinalSubmit) {
        const submit = await evaluateFormDom<{ clicked: boolean; reason?: string }>(page, "submit");
        lastNavigationReason = submit.reason ?? (submit.clicked ? "submit-clicked" : "no-submit");
        if (submit.clicked) {
          hostSubmitClicked = true;
          await page.waitForTimeout(STEP_WAIT_MS);
          const confirmed = await evaluateFormDom<boolean>(page, "confirm");
          await context.close();
          return {
            ok: true,
            submitted: confirmed,
            hostSubmitClicked: true,
            filledFields: totalFilled,
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
      return { ok: true, submitted: false, hostSubmitClicked: true, filledFields: totalFilled };
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
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return true;
}
