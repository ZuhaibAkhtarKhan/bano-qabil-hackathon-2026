import {
  beginHostSubmitJob,
  completeHostSubmitJob,
  connectWithWebsiteSession,
  createBatchFillPlan,
  createFillPlan,
  endFillSession,
  fetchDocumentFile,
  fetchPendingHostSubmitJobs,
  fetchSession,
  generateAiDraft,
  ingestOpportunity,
  listApplications,
  type ExtensionHostSubmitJob,
} from "../api/client";
import type { DetectedField } from "@1apply/form-engine";

type InventoryResponse = {
  type: string;
  fields: DetectedField[];
  hazards?: {
    captcha?: boolean;
    captchaMessage?: string | null;
    accountCreation?: boolean;
    accountMessage?: string | null;
    unsupported?: boolean;
    unsupportedReason?: string | null;
  };
  url: string;
  title: string;
  tabId: number;
  origin: string;
};

type Mapping = {
  fieldKey: string;
  label: string;
  memoryPath: string;
  source: string;
  confidence: number;
  proposedValue: string;
  options?: Array<{ value: string; label: string; source: string }>;
  approvalState: string;
  sensitive: boolean;
  excludedByDefault: boolean;
  reason: string;
  fieldType: string;
  aiAnswerable?: boolean;
  showChip?: boolean;
  attachment?: {
    documentId: string;
    versionId: string;
    filename: string;
    mimeType: string;
    byteSize: number;
  } | null;
};

type AttachedFile = {
  versionId: string;
  filename: string;
  mimeType: string;
  base64: string;
};

type FillSession = {
  applicationId: string;
  origin: string;
  tabId: number;
  enabled: boolean;
  updatedAt: number;
  fillSessionId?: string;
  pageIndex?: number;
};

const FILL_SESSION_KEY = "fillSession";
const AWAITING_HOST_CONTINUE_KEY = "awaitingHostContinueUntil";
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const FAST_HOST_POLL_ALARM = "fast-poll-host-submit";
const HOST_SUBMIT_ALARM = "poll-host-submit-jobs";
/** Bumped on Stop so in-flight work aborts cleanly. */
let fillHaltGeneration = 0;

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");
  return tab;
}

function tabOrigin(tab: chrome.tabs.Tab): string {
  if (!tab.url) throw new Error("The active tab has no URL.");
  const parsed = new URL(tab.url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Open a public http(s) page first.");
  }
  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1") {
    throw new Error("Local pages cannot be ingested or filled.");
  }
  return parsed.origin;
}

async function ensureHostAccess(origin: string, soft = false): Promise<void> {
  const origins = [`${origin}/*`];
  const already = await chrome.permissions.contains({ origins });
  if (already) return;
  if (soft) {
    const granted = await chrome.permissions.request({ origins }).catch(() => false);
    if (granted) return;
  }
  throw new Error(
    soft
      ? "Open this form once and allow 1-Apply site access so deadline submit can run in your browser."
      : "Site access is missing. Click Fill/Save in the 1-Apply popup once and allow access when Chrome asks.",
  );
}

async function saveFillSession(session: FillSession): Promise<void> {
  await chrome.storage.local.set({ [FILL_SESSION_KEY]: session });
}

async function loadFillSession(): Promise<FillSession | null> {
  const data = await chrome.storage.local.get([FILL_SESSION_KEY]);
  const session = data[FILL_SESSION_KEY] as FillSession | undefined;
  if (!session?.enabled || !session.applicationId) return null;
  if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
    await chrome.storage.local.remove(FILL_SESSION_KEY);
    return null;
  }
  return session;
}

async function ensureContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

async function sendToTab<T>(tabId: number, message: unknown): Promise<T> {
  await ensureContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
}

function looksLikeSubmitConfirmation(url: string, pageText = ""): boolean {
  const blob = `${url}\n${pageText}`.toLowerCase();
  return (
    /formresponse|form_response/.test(blob) ||
    /response has been recorded|your response was submitted|thanks for (your )?response|thank you for (submitting|your response)/i.test(
      blob,
    ) ||
    (/submitted/i.test(blob) && /thank/i.test(blob))
  );
}

/** After Submit, the host navigates — confirm from the background so the content script can unload. */
async function waitForHostSubmitConfirmation(tabId: number, timeoutMs = 14000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url ?? tab.pendingUrl ?? "";
      if (looksLikeSubmitConfirmation(url)) return true;
      if (tab.status === "complete") {
        try {
          await ensureContentScript(tabId);
          const meta = (await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_META" })) as {
            url?: string;
            pageText?: string;
            excerpt?: string;
          } | null;
          if (meta && looksLikeSubmitConfirmation(meta.url ?? url, `${meta.pageText ?? ""} ${meta.excerpt ?? ""}`)) {
            return true;
          }
        } catch {
          // Content script may not be injectable yet on the confirmation page.
        }
      }
    } catch {
      // Tab closed mid-navigation — treat as unknown; caller decides.
      return false;
    }
    await sleep(700);
  }
  return false;
}

async function clickHostSubmitAndConfirm(tabId: number): Promise<{
  clicked: boolean;
  confirmed: boolean;
  reason?: string;
}> {
  let clicked = false;
  let reason: string | undefined;
  try {
    const result = (await sendToTab<{
      clicked?: boolean;
      confirmed?: boolean;
      reason?: string;
    }>(tabId, {
      type: "CLICK_HOST_SUBMIT",
      hostSubmitAllowed: true,
    })) as { clicked?: boolean; confirmed?: boolean; reason?: string };
    clicked = Boolean(result?.clicked);
    reason = result?.reason;
    if (result?.confirmed) return { clicked: true, confirmed: true, reason: "confirmed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Channel closed because Google Forms unloaded the page after Submit — click likely landed.
    if (/message channel closed|asynchronous response|Receiving end does not exist/i.test(message)) {
      clicked = true;
      reason = "channel-closed-after-click";
    } else {
      return { clicked: false, confirmed: false, reason: message };
    }
  }

  if (!clicked) return { clicked: false, confirmed: false, reason: reason || "no-submit" };

  const confirmed = await waitForHostSubmitConfirmation(tabId);
  return {
    clicked: true,
    confirmed,
    reason: confirmed ? "confirmed" : reason || "no-confirmation",
  };
}

async function loadAttachedFiles(mappings: Mapping[]): Promise<Map<string, AttachedFile>> {
  const files = new Map<string, AttachedFile>();
  const versionIds = new Set<string>();
  for (const mapping of mappings) {
    if (mapping.fieldType !== "file") continue;
    if (mapping.attachment?.versionId) versionIds.add(mapping.attachment.versionId);
    if (mapping.proposedValue) versionIds.add(mapping.proposedValue);
    for (const option of mapping.options ?? []) {
      if (option.value) versionIds.add(option.value);
    }
  }

  await Promise.all(
    Array.from(versionIds)
      .slice(0, 6)
      .map(async (versionId) => {
        try {
          const file = await fetchDocumentFile(versionId);
          files.set(versionId, {
            versionId: file.versionId,
            filename: file.filename,
            mimeType: file.mimeType,
            base64: file.base64,
          });
        } catch {
          // Leave missing; content script will skip attach.
        }
      }),
  );
  return files;
}

type BatchFieldResult = {
  fieldId: string;
  status: "filled" | "need_you";
  value?: string;
  evidenceIds?: string[];
  documentVersionId?: string;
  applyMode?: "auto" | "chip" | "ai_assistant" | "skip";
  reason?: string;
};

async function trackExtensionFormTab(input: {
  applicationId: string;
  origin: string;
  tabId: number;
  fillSessionId?: string;
}): Promise<void> {
  await saveFillSession({
    applicationId: input.applicationId,
    origin: input.origin,
    tabId: input.tabId,
    enabled: true,
    updatedAt: Date.now(),
    fillSessionId: input.fillSessionId,
  });
}

async function loadBatchFiles(results: BatchFieldResult[]): Promise<Map<string, AttachedFile>> {
  const files = new Map<string, AttachedFile>();
  const versionIds = [
    ...new Set(results.map((item) => item.documentVersionId).filter((id): id is string => Boolean(id))),
  ];
  await Promise.all(
    versionIds.slice(0, 6).map(async (versionId) => {
      try {
        const file = await fetchDocumentFile(versionId);
        files.set(versionId, {
          versionId: file.versionId,
          filename: file.filename,
          mimeType: file.mimeType,
          base64: file.base64,
        });
      } catch {
        // Content script skips attach when bytes are missing.
      }
    }),
  );
  return files;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runBatchFillOnTab(input: {
  tabId: number;
  origin: string;
  applicationId: string;
  pageIndex: number;
  resumeFill?: boolean;
  /** Host-submit job: click Next between pages. */
  autoContinue?: boolean;
  /** Host-submit job: allow final Submit click in content script. */
  hostSubmitAllowed?: boolean;
}) {
  let inventory: {
    fields?: Array<{ fieldId?: string; type?: string; label?: string; required?: boolean }>;
    hazards?: unknown;
    url?: string;
    title?: string;
  } | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await sleep(350 * attempt);
    try {
      inventory = await sendToTab(input.tabId, { type: "INVENTORY_BATCH" });
    } catch {
      inventory = null;
    }
    if (inventory?.fields && Array.isArray(inventory.fields) && inventory.fields.length > 0) break;
  }
  if (!inventory?.fields?.length) {
    throw new Error("no-fields");
  }

  // Brief settle for Google Forms widgets after inventory.
  await sleep(350);

  const hazards = inventory.hazards as
    | {
        captcha?: boolean;
        captchaMessage?: string | null;
        accountCreation?: boolean;
        accountMessage?: string | null;
      }
    | undefined;
  if (hazards?.captcha) {
    throw Object.assign(new Error(hazards.captchaMessage || "CAPTCHA blocked host fill."), {
      code: "captcha",
    });
  }
  if (hazards?.accountCreation) {
    throw Object.assign(new Error(hazards.accountMessage || "Account wall blocked host fill."), {
      code: "account",
    });
  }

  // Host jobs prefer saved Need You / kit — skip slow LLM drafting on every page.
  const plan = await createBatchFillPlan({
    applicationId: input.applicationId,
    pageIndex: input.pageIndex,
    origin: input.origin,
    fields: inventory.fields ?? [],
    skipAi: true,
  });

  const files = await loadBatchFiles(plan.fields);
  const typeById = new Map(
    (inventory.fields ?? []).map((field) => [String(field.fieldId ?? ""), String(field.type ?? "")]),
  );
  const labelById = new Map(
    (inventory.fields ?? []).map((field) => [String(field.fieldId ?? ""), String(field.label ?? "").trim()]),
  );
  const applied = (await sendToTab(input.tabId, {
    type: "APPLY_BATCH_RESULTS",
    origin: input.origin,
    applicationId: input.applicationId,
    autoContinue: Boolean(input.autoContinue),
    hostSubmitAllowed: Boolean(input.hostSubmitAllowed),
    resumeFill: Boolean(input.resumeFill),
    results: plan.fields.map((item) => ({
      ...item,
      type: typeById.get(item.fieldId) || undefined,
    })),
    files: Array.from(files.values()),
  })) as {
    filled?: Array<{ fieldId?: string; filled?: boolean }>;
    highlighted?: number;
    stopped?: boolean;
  };

  // Widgets (radios / listboxes) often need a moment after click before Next is enabled.
  await sleep(450);

  const needYouFields = plan.fields.filter((item) => item.status === "need_you");
  // Required and optional both block Next until filled or explicitly skipped in Need You.
  const needYouLabels = needYouFields
    .map((item) => labelById.get(item.fieldId) || item.reason || item.fieldId)
    .filter(Boolean)
    .slice(0, 8);

  return {
    ...applied,
    fillSessionId: plan.fillSessionId,
    filledCount: applied.filled?.filter((item) => item.filled).length ?? 0,
    highlighted: applied.highlighted ?? 0,
    needYouCount: needYouFields.length,
    needYouLabels,
  };
}

async function getPageStepState(tabId: number): Promise<{
  hasNext: boolean;
  hasSubmit: boolean;
  emptyHighlighted: number;
}> {
  try {
    return (await sendToTab(tabId, { type: "GET_PAGE_STEP_STATE" })) as {
      hasNext: boolean;
      hasSubmit: boolean;
      emptyHighlighted: number;
    };
  } catch {
    return { hasNext: false, hasSubmit: false, emptyHighlighted: 0 };
  }
}

/**
 * Every page: inventory → fill from memory → pause on any Need You gap (required or optional)
 * → recheck → only then Next. Never advances past unverified fields.
 * Does not click Submit; caller does that when clickFinalSubmit is allowed.
 */
async function walkHostFormPages(input: {
  tabId: number;
  origin: string;
  applicationId: string;
  hostSubmitAllowed: boolean;
  maxSteps?: number;
}): Promise<{
  totalFilled: number;
  needYouLabels: string[];
  stuckHighlighted: number;
  pagesVisited: number;
  reachedSubmitPage: boolean;
  pageComplete: boolean;
}> {
  let pageIndex = 0;
  let totalFilled = 0;
  const needYouLabels: string[] = [];
  let stuckHighlighted = 0;
  let reachedSubmitPage = false;
  const maxSteps = input.maxSteps ?? 14;

  for (let step = 0; step < maxSteps; step += 1) {
    let result = await runBatchFillOnTab({
      tabId: input.tabId,
      origin: input.origin,
      applicationId: input.applicationId,
      pageIndex,
      resumeFill: true,
      autoContinue: false,
      hostSubmitAllowed: input.hostSubmitAllowed,
    });
    totalFilled += result.filledCount;

    // Recheck only when something is still empty / Need You.
    if (result.highlighted > 0 || result.needYouCount > 0) {
      await sleep(500);
      const retry = await runBatchFillOnTab({
        tabId: input.tabId,
        origin: input.origin,
        applicationId: input.applicationId,
        pageIndex,
        resumeFill: true,
        autoContinue: false,
        hostSubmitAllowed: input.hostSubmitAllowed,
      });
      totalFilled += retry.filledCount;
      result = retry;
    }

    for (const label of result.needYouLabels) {
      if (!needYouLabels.includes(label)) needYouLabels.push(label);
    }
    stuckHighlighted = result.highlighted;

    const pageAudit = await auditPageFields(input.tabId);
    const gaps = Math.max(result.needYouCount, result.highlighted, pageAudit.emptyCount);
    const currentGapLabels =
      result.needYouLabels.length > 0 ? result.needYouLabels : pageAudit.emptyLabels;

    const stepState = await getPageStepState(input.tabId);
    reachedSubmitPage = stepState.hasSubmit && !stepState.hasNext;

    // Any empty / Need You field (including optional) blocks advance.
    if (gaps > 0) {
      return {
        totalFilled,
        needYouLabels: currentGapLabels.slice(0, 8),
        stuckHighlighted: Math.max(stuckHighlighted, pageAudit.emptyCount),
        pagesVisited: pageIndex + 1,
        reachedSubmitPage,
        pageComplete: false,
      };
    }

    if (reachedSubmitPage || !stepState.hasNext) {
      return {
        totalFilled,
        needYouLabels: [],
        stuckHighlighted: 0,
        pagesVisited: pageIndex + 1,
        reachedSubmitPage: reachedSubmitPage || stepState.hasSubmit,
        pageComplete: true,
      };
    }

    const advance = (await sendToTab<{ clicked: boolean; reason?: string }>(input.tabId, {
      type: "FORCE_STEP_ADVANCE",
    }).catch(() => ({ clicked: false, reason: "error" }))) as {
      clicked: boolean;
      reason?: string;
    };

    if (advance.clicked && advance.reason !== "no-change") {
      pageIndex += 1;
      await sleep(900);
      continue;
    }

    return {
      totalFilled,
      needYouLabels: currentGapLabels.slice(0, 8),
      stuckHighlighted: Math.max(stuckHighlighted, pageAudit.emptyCount),
      pagesVisited: pageIndex + 1,
      reachedSubmitPage: (await getPageStepState(input.tabId)).hasSubmit,
      pageComplete: advance.reason === "no-next",
    };
  }

  return {
    totalFilled,
    needYouLabels: needYouLabels.slice(0, 8),
    stuckHighlighted,
    pagesVisited: pageIndex + 1,
    reachedSubmitPage,
    pageComplete: false,
  };
}

/** Count empty inventoried fields on the current page (required and optional). */
async function auditPageFields(tabId: number): Promise<{ emptyCount: number; emptyLabels: string[] }> {
  try {
    return (await sendToTab(tabId, { type: "AUDIT_PAGE_FIELDS" })) as {
      emptyCount: number;
      emptyLabels: string[];
    };
  } catch {
    return { emptyCount: 0, emptyLabels: [] };
  }
}

async function waitForTabComplete(tabId: number, timeoutMs = 45000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Timed out waiting for form page to load."));
    }, timeoutMs);

    function onUpdated(id: number, info: { status?: string }) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }

    void chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
        return;
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  });
}

/** Open the host form in a background tab, or reuse the existing tab for this application. */
async function openOrReuseFormTab(
  applicationId: string,
  sourceUrl: string,
): Promise<{ tabId: number; origin: string; reused: boolean }> {
  const origin = new URL(sourceUrl).origin;
  const existing = await loadFillSession();
  if (existing?.applicationId === applicationId && existing.tabId != null) {
    try {
      const tab = await chrome.tabs.get(existing.tabId);
      if (tab.id != null) {
        const tabUrl = tab.url ? new URL(tab.url) : null;
        if (tabUrl && tabUrl.origin === origin) {
          await ensureHostAccess(origin, true);
          return { tabId: tab.id, origin, reused: true };
        }
      }
    } catch {
      // Tab was closed — open a fresh one below.
    }
  }

  await ensureHostAccess(origin, true);
  const tab = await chrome.tabs.create({ url: sourceUrl, active: false });
  if (!tab.id) throw new Error("Could not open host form tab in the background.");
  await waitForTabComplete(tab.id);
  await sleep(1200);
  return { tabId: tab.id, origin, reused: false };
}

async function closeBackgroundTab(tabId: number | null): Promise<void> {
  if (tabId == null) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Tab may already be closed.
  }
}

/**
 * Prefill: open (or reuse) form → fill → Need You → recheck → Next until Submit page.
 * Submit window: reuse same tab when possible, verify Submit page, then Submit.
 * Keeps the form tab open across Need You pauses and page-loop continues until Submit finishes.
 */
async function runHostSubmitJob(job: ExtensionHostSubmitJob): Promise<void> {
  let tabId: number | null = null;
  let keepTabOpen = false;
  try {
    const begin = await beginHostSubmitJob(job.jobId);
    if (!begin.ok) return;

    const opened = await openOrReuseFormTab(job.applicationId, job.sourceUrl);
    tabId = opened.tabId;
    await trackExtensionFormTab({
      applicationId: job.applicationId,
      origin: opened.origin,
      tabId,
    });

    // Always fill page-by-page (memory → Need You). Submit click only when allowed.
    const stillAllowed = await beginHostSubmitJob(job.jobId);
    if (!stillAllowed.ok) {
      keepTabOpen = true;
      return;
    }

    const fillPass = await walkHostFormPages({
      tabId,
      origin: opened.origin,
      applicationId: job.applicationId,
      hostSubmitAllowed: false,
    });

    if (!fillPass.pageComplete || fillPass.needYouLabels.length > 0 || fillPass.stuckHighlighted > 0) {
      await sleep(600);
      await completeHostSubmitJob({
        jobId: job.jobId,
        filledFields: fillPass.totalFilled,
        pausedForNeedsYou: true,
        missingRequired: fillPass.needYouLabels.length
          ? fillPass.needYouLabels
          : ["Unanswered fields on this page"],
      });
      keepTabOpen = true;
      await markAwaitingHostContinue();
      return;
    }

    if (!job.clickFinalSubmit) {
      await sleep(400);
      await completeHostSubmitJob({
        jobId: job.jobId,
        filledFields: fillPass.totalFilled,
      });
      // Prefill done / waiting for deadline window — keep tab for later Submit.
      keepTabOpen = true;
      await clearAwaitingHostContinue();
      return;
    }

    const beforeClick = await beginHostSubmitJob(job.jobId);
    if (!beforeClick.ok) {
      keepTabOpen = true;
      return;
    }

    await sleep(800);
    const submit = await clickHostSubmitAndConfirm(tabId);

    await sleep(600);
    await completeHostSubmitJob({
      jobId: job.jobId,
      filledFields: fillPass.totalFilled,
      submitted: Boolean(submit.confirmed),
      hostSubmitClicked: Boolean(submit.clicked),
      error: submit.confirmed
        ? undefined
        : submit.clicked
          ? "Submit clicked but host did not confirm."
          : submit.reason || "Could not find Submit on the host form.",
    });
    // Close after a terminal submit attempt (success or confirmed click).
    keepTabOpen = false;
    await clearAwaitingHostContinue();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Host job failed.";
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
    // Don't report the Chrome messaging race as a hard submit failure when click likely happened.
    const channelRace = /message channel closed|asynchronous response/i.test(message);
    await completeHostSubmitJob({
      jobId: job.jobId,
      filledFields: 0,
      submitted: false,
      hostSubmitClicked: channelRace,
      blockedReason: code === "captcha" || code === "account" ? message : undefined,
      error: code === "captcha" || code === "account" ? undefined : channelRace ? "Submit click may have succeeded; confirmation was interrupted." : message,
    }).catch(() => undefined);
    keepTabOpen = code === "captcha" || code === "account";
  } finally {
    if (keepTabOpen) {
      // Leave the form tab open for Need You continue / deadline Submit.
      return;
    }
    await sleep(800);
    await closeBackgroundTab(tabId);
    await chrome.storage.local.remove(FILL_SESSION_KEY).catch(() => undefined);
  }
}

let hostJobPollRunning = false;

async function markAwaitingHostContinue(): Promise<void> {
  // Keep polling for ~3 minutes after Need You pause so answers resume quickly.
  await chrome.storage.local.set({ [AWAITING_HOST_CONTINUE_KEY]: Date.now() + 3 * 60 * 1000 });
  scheduleFastHostPoll(0.05);
  // Ensure Need You tabs can wake the poll via postMessage → bridge.
  try {
    const { resolveAppBaseUrl } = await import("../shared/app-url");
    const origin = new URL(await resolveAppBaseUrl()).origin;
    const tabs = await chrome.tabs.query({ url: `${origin}/*` });
    await Promise.all(
      tabs.map(async (tab) => {
        if (!tab.id) return;
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["bridge.js"] }).catch(() => undefined);
      }),
    );
  } catch {
    // Best-effort.
  }
}

async function clearAwaitingHostContinue(): Promise<void> {
  await chrome.storage.local.remove(AWAITING_HOST_CONTINUE_KEY);
  await chrome.alarms.clear(FAST_HOST_POLL_ALARM).catch(() => undefined);
}

async function isAwaitingHostContinue(): Promise<boolean> {
  const data = await chrome.storage.local.get([AWAITING_HOST_CONTINUE_KEY]);
  const until = Number(data[AWAITING_HOST_CONTINUE_KEY] ?? 0);
  if (!until) return false;
  if (Date.now() > until) {
    await clearAwaitingHostContinue();
    return false;
  }
  return true;
}

function scheduleFastHostPoll(delayInMinutes: number): void {
  chrome.alarms.create(FAST_HOST_POLL_ALARM, { delayInMinutes: Math.max(0.05, delayInMinutes) });
}

async function pollAndRunHostSubmitJobs(): Promise<void> {
  if (hostJobPollRunning) return;
  hostJobPollRunning = true;
  try {
    const jobs = await fetchPendingHostSubmitJobs();
    if (jobs.length) await clearAwaitingHostContinue();
    for (const job of jobs) {
      await runHostSubmitJob(job);
    }
  } catch {
    // Not signed in / API unreachable — try again on next alarm.
  } finally {
    hostJobPollRunning = false;
    if (await isAwaitingHostContinue()) {
      scheduleFastHostPoll(0.08);
    }
  }
}

function ensureHostSubmitAlarm(): void {
  chrome.alarms.create(HOST_SUBMIT_ALARM, { periodInMinutes: 1, delayInMinutes: 0.15 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureHostSubmitAlarm();
});

ensureHostSubmitAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HOST_SUBMIT_ALARM || alarm.name === FAST_HOST_POLL_ALARM) {
    void pollAndRunHostSubmitJobs();
  }
});

async function applyMappingsToTab(input: {
  tabId: number;
  origin: string;
  applicationId: string;
  mappings: Mapping[];
  highlightKeys?: string[];
  /** True when the user explicitly clicked Fill — clears a prior Stop. */
  resumeFill?: boolean;
}) {
  const mappings = input.mappings.filter(
    (item) => item.approvalState !== "blocked" && !item.sensitive && item.memoryPath !== "Blocked",
  );
  const files = await loadAttachedFiles(mappings);
  const highlightKeys = input.highlightKeys ?? input.mappings.map((item) => item.fieldKey);

  return sendToTab(input.tabId, {
    type: "APPLY_SUGGESTIONS",
    origin: input.origin,
    applicationId: input.applicationId,
    highlightKeys,
    autoContinue: false,
    resumeFill: Boolean(input.resumeFill),
    mappings: mappings.map((item) => {
      const versionId = item.attachment?.versionId || item.proposedValue;
      const file = versionId ? files.get(versionId) : undefined;
      const aiAnswerable = Boolean(item.aiAnswerable);
      return {
        fieldKey: item.fieldKey,
        label: item.label,
        value: aiAnswerable ? "" : item.fieldType === "file" ? versionId || "" : item.proposedValue,
        type: item.fieldType,
        showChip: true,
        aiAnswerable,
        options: item.options?.length
          ? item.options
          : item.proposedValue && !aiAnswerable
            ? [{ value: item.proposedValue, label: item.memoryPath, source: item.source }]
            : [],
        file: file
          ? {
              versionId: file.versionId,
              filename: file.filename,
              mimeType: file.mimeType,
              base64: file.base64,
            }
          : item.attachment
            ? {
                versionId: item.attachment.versionId,
                filename: item.attachment.filename,
                mimeType: item.attachment.mimeType,
                base64: "",
              }
            : null,
      };
    }),
  });
}

async function syncManualFillCapture(input: {
  tabId: number;
  applicationId: string;
  origin: string;
  fillSessionId?: string;
}): Promise<void> {
  const captured = await captureFilledState(input.tabId);
  try {
    await endFillSession({
      applicationId: input.applicationId,
      reason: "stopped",
      origin: captured?.origin || input.origin,
      fillSessionId: input.fillSessionId,
      pageUrl: captured?.pageUrl,
      pageText: captured?.pageText,
      fields: captured?.fields ?? [],
      formPage: captured?.formPage,
    });
  } catch {
    // Best-effort sync after a one-shot manual fill.
  }
}

async function clearFillSession(
  tabId?: number,
  reason: "stopped" | "tab_closed" | "origin_left" = "stopped",
): Promise<void> {
  const session = await loadFillSession();
  if (!session) {
    fillHaltGeneration += 1;
    if (tabId != null) {
      try {
        await sendToTab(tabId, { type: "STOP_AUTO_CONTINUE" });
      } catch {
        // Tab may already be gone.
      }
    }
    return;
  }
  if (tabId != null && session.tabId !== tabId) return;

  fillHaltGeneration += 1;
  await syncFillSessionEnd(session, reason);

  await chrome.storage.local.remove(FILL_SESSION_KEY);
  if (session.tabId) {
    try {
      await sendToTab(session.tabId, { type: "STOP_AUTO_CONTINUE" });
    } catch {
      // Tab may already be gone.
    }
  }
}

type CapturedFillState = {
  origin: string;
  pageUrl: string;
  pageText: string;
  fields: Array<{
    fieldKey: string;
    fieldId?: string;
    label: string;
    value: string;
    required: boolean;
    fieldType: string;
    options?: string[];
    maxLength?: number;
    nearbyText?: string;
    placeholder?: string;
  }>;
  formPage?: {
    pageIndex?: number;
    pageUrl?: string;
    pageTitle?: string;
    origin?: string;
    hazards?: unknown;
    fields: unknown[];
  };
};

async function captureFilledState(tabId: number): Promise<CapturedFillState | null> {
  try {
    return await sendToTab<CapturedFillState>(tabId, { type: "CAPTURE_FILLED_STATE" });
  } catch {
    return null;
  }
}

async function syncFillSessionEnd(
  session: FillSession,
  reason: "stopped" | "tab_closed" | "origin_left" | "submitted_detected",
): Promise<void> {
  let captured: CapturedFillState | null = null;
  if (session.tabId) {
    captured = await captureFilledState(session.tabId);
  }

  try {
    await endFillSession({
      applicationId: session.applicationId,
      reason,
      origin: captured?.origin || session.origin,
      fillSessionId: session.fillSessionId,
      pageUrl: captured?.pageUrl,
      pageText: captured?.pageText,
      fields: captured?.fields ?? [],
      formPage: captured?.formPage,
    });
  } catch {
    // Best-effort: local stop must still succeed if the API is unreachable.
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const task = (async () => {
    if (message?.type === "SESSION") return fetchSession();
    if (message?.type === "CONNECT_WEBSITE") {
      const session = await connectWithWebsiteSession();
      void pollAndRunHostSubmitJobs();
      return session;
    }
    if (message?.type === "LIST_APPLICATIONS") return listApplications();
    if (message?.type === "POLL_HOST_SUBMIT_JOBS") {
      await pollAndRunHostSubmitJobs();
      return { ok: true };
    }
    if (message?.type === "AUTO_CONTINUE_FILL") {
      const session = await loadFillSession();
      const tabId = sender.tab?.id ?? session?.tabId;
      if (!tabId || !session) return { ok: false };
      const origin = tabOrigin({ url: sender.tab?.url || session.origin } as chrome.tabs.Tab);
      return runBatchFillOnTab({
        tabId,
        origin: session.origin || origin,
        applicationId: session.applicationId,
        pageIndex: typeof message.pageIndex === "number" ? message.pageIndex : (session.pageIndex ?? 0) + 1,
        resumeFill: true,
        autoContinue: true,
        hostSubmitAllowed: Boolean(message.hostSubmitAllowed),
      });
    }
    if (message?.type === "FILL_SESSION_STATUS") {
      const session = await loadFillSession();
      return { active: Boolean(session), applicationId: session?.applicationId ?? null };
    }
    if (message?.type === "GENERATE_AI_DRAFT") {
      return generateAiDraft({
        applicationId: String(message.applicationId ?? ""),
        question: String(message.question ?? ""),
        fieldKey: message.fieldKey ? String(message.fieldKey) : undefined,
        guidance: message.guidance ? String(message.guidance) : undefined,
        limitValue: typeof message.limitValue === "number" ? message.limitValue : null,
        limitUnit:
          message.limitUnit === "words" || message.limitUnit === "characters" ? message.limitUnit : null,
      });
    }

    if (message?.type === "STOP_FILL_SESSION") {
      fillHaltGeneration += 1;
      const session = await loadFillSession();
      if (session) {
        await syncFillSessionEnd(session, "stopped");
      }
      await chrome.storage.local.remove(FILL_SESSION_KEY);
      const tabId = session?.tabId ?? (await activeTab().catch(() => null))?.id;
      if (tabId) {
        try {
          await sendToTab(tabId, { type: "STOP_AUTO_CONTINUE" });
        } catch {
          // Ignore closed tabs.
        }
      }
      return { ok: true };
    }

    if (message?.type === "ATTACH_FILE_ALL_FRAMES") {
      const tab = await activeTab();
      if (!tab.id) throw new Error("No active tab.");
      const results = (await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: (file: { filename: string; mimeType: string; base64: string }) => {
          const wanted = (file.filename || "").trim().toLowerCase().replace(/^.*[\\/]/, "");
          const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
          let already = false;
          for (const input of inputs) {
            const names = Array.from(input.files ?? []).map((item) => item.name.toLowerCase());
            if (names.length && (!wanted || names.some((name) => name === wanted || name.endsWith(wanted)))) {
              already = true;
            }
          }
          const pageText = (document.body?.innerText ?? "").toLowerCase();
          if (wanted && pageText.includes(wanted) && /uploaded|selected|attached|remove file/i.test(pageText)) {
            already = true;
          }
          if (already) return true;

          const binary = atob(file.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          const blob = new File([bytes], file.filename || "document.pdf", {
            type: file.mimeType || "application/pdf",
          });
          let ok = false;
          for (const input of inputs) {
            const transfer = new DataTransfer();
            transfer.items.add(blob);
            input.files = transfer.files;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            if ((input.files?.length ?? 0) > 0) ok = true;
          }
          return ok;
        },
        args: [message.file as { filename: string; mimeType: string; base64: string }],
      })) as Array<{ result?: boolean }>;
      return { ok: results.some((item) => item.result) };
    }

    if (message?.type === "SAVE_PAGE") {
      const tab = await activeTab();
      if (!tab.id) throw new Error("No active tab.");
      const origin = tabOrigin(tab);
      await ensureHostAccess(origin);
      const meta = await sendToTab<{ url: string; title: string; excerpt: string; pageText?: string }>(tab.id, { type: "GET_PAGE_META" });
      const pageUrl = meta.url || tab.url || "";
      if (new URL(pageUrl).origin !== origin) {
        throw new Error("Page origin changed. Refresh and try again.");
      }
      let formPage: {
        pageIndex: number;
        pageUrl?: string;
        pageTitle?: string;
        origin: string;
        hazards?: unknown;
        fields: unknown[];
      } | undefined;
      try {
        const inventory = await sendToTab<{
          fields?: unknown[];
          hazards?: unknown;
          url?: string;
          title?: string;
        }>(tab.id, { type: "INVENTORY_BATCH" });
        if (inventory?.fields?.length) {
          formPage = {
            pageIndex: 0,
            pageUrl: inventory.url || pageUrl,
            pageTitle: inventory.title || meta.title,
            origin,
            hazards: inventory.hazards ?? {},
            fields: inventory.fields,
          };
        }
      } catch {
        // Not every saved page is an application form.
      }
      return ingestOpportunity({
        url: pageUrl,
        title: meta.title || tab.title || undefined,
        excerpt: meta.excerpt,
        pageText: meta.pageText || meta.excerpt,
        formPage,
      }).then(async (result) => {
        if (formPage?.fields?.length && tab.id != null) {
          await trackExtensionFormTab({
            applicationId: result.applicationId,
            origin,
            tabId: tab.id,
          });
        }
        return result;
      });
    }

    if (message?.type === "SCAN_FORM") {
      const tab = await activeTab();
      if (!tab.id) throw new Error("No active tab.");
      const origin = tabOrigin(tab);
      await ensureHostAccess(origin);
      const inventory = await sendToTab<InventoryResponse>(tab.id, { type: "INVENTORY" });
      return { ...inventory, tabId: tab.id, origin };
    }

    if (message?.type === "FETCH_DOCUMENT") {
      return fetchDocumentFile(String(message.versionId ?? ""));
    }

    if (message?.type === "SCAN_AND_FILL_BATCH") {
      const tab = await activeTab();
      if (!tab.id) throw new Error("No active tab.");
      const origin = tabOrigin(tab);
      const expectedOrigin = String(message.origin ?? origin);
      if (origin !== expectedOrigin) {
        throw new Error("Page origin changed. Try Fill from memory again.");
      }
      await ensureHostAccess(origin);
      const applicationId = String(message.applicationId ?? "");
      if (!applicationId) throw new Error("Save this page to 1-Apply first.");
      const pageIndex = typeof message.pageIndex === "number" ? message.pageIndex : 0;
      const result = await runBatchFillOnTab({
        tabId: tab.id,
        origin,
        applicationId,
        pageIndex,
        resumeFill: true,
      });
      await trackExtensionFormTab({
        applicationId,
        origin,
        tabId: tab.id,
        fillSessionId: result.fillSessionId ?? undefined,
      });
      await syncManualFillCapture({
        tabId: tab.id,
        applicationId,
        origin,
        fillSessionId: result.fillSessionId ?? undefined,
      });
      return result;
    }

    if (message?.type === "CREATE_FILL_PLAN") {
      return createFillPlan({
        applicationId: String(message.applicationId),
        origin: String(message.origin ?? ""),
        fields: message.fields as unknown[],
        hazards: message.hazards,
      });
    }

    if (message?.type === "APPLY_SUGGESTIONS" || message?.type === "APPLY_SUGGESTIONS" || message?.type === "FILL" || message?.type === "FILL_APPROVED") {
      const tab = await activeTab();
      if (!tab.id) throw new Error("No active tab.");
      const origin = tabOrigin(tab);
      const expectedOrigin = String(message.origin ?? "");
      const expectedTabId = Number(message.tabId);
      if (!expectedOrigin || origin !== expectedOrigin) {
        throw new Error("Page origin changed. Try Fill from memory again.");
      }
      if (expectedTabId && expectedTabId !== tab.id) {
        throw new Error("Active tab changed. Try Fill from memory again.");
      }

      await ensureHostAccess(origin);
      const applicationId = String(message.applicationId ?? "");
      const fillSessionId = message.fillSessionId ? String(message.fillSessionId) : undefined;

      const applied = await applyMappingsToTab({
        tabId: tab.id,
        origin,
        applicationId,
        mappings: message.mappings as Mapping[],
        highlightKeys: Array.isArray(message.highlightKeys) ? (message.highlightKeys as string[]) : undefined,
        resumeFill: true,
      });
      if (applicationId) {
        await syncManualFillCapture({ tabId: tab.id, applicationId, origin, fillSessionId });
      }
      return applied;
    }

    throw new Error("Unknown message.");
  })();

  task.then(sendResponse).catch((error: Error) => sendResponse({ error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearFillSession(tabId, "tab_closed");
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const nextUrl = changeInfo.url;
  void (async () => {
    const session = await loadFillSession();
    if (!session || session.tabId !== tabId) return;
    try {
      const nextOrigin = new URL(nextUrl).origin;
      if (nextOrigin !== session.origin) {
        await clearFillSession(tabId, "origin_left");
      }
    } catch {
      await clearFillSession(tabId, "origin_left");
    }
  })();
});
