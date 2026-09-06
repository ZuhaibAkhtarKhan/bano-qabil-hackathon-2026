import {
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
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
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
  let inventory: { fields?: unknown[]; hazards?: unknown; url?: string; title?: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
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

  const plan = await createBatchFillPlan({
    applicationId: input.applicationId,
    pageIndex: input.pageIndex,
    origin: input.origin,
    fields: inventory.fields ?? [],
  });

  const files = await loadBatchFiles(plan.fields);
  const typeById = new Map(
    (inventory.fields as Array<{ fieldId?: string; type?: string }>).map((field) => [
      String(field.fieldId ?? ""),
      String(field.type ?? ""),
    ]),
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

  return {
    ...applied,
    fillSessionId: plan.fillSessionId,
    filledCount: applied.filled?.filter((item) => item.filled).length ?? 0,
    highlighted: applied.highlighted ?? 0,
  };
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

async function openFormTab(sourceUrl: string): Promise<{ tabId: number; origin: string }> {
  const origin = new URL(sourceUrl).origin;
  await ensureHostAccess(origin, true);
  const existing = await chrome.tabs.query({ url: `${origin}/*` });
  const match = existing.find((tab) => tab.id && tab.url && tab.url.startsWith(sourceUrl.split("?")[0]!));
  if (match?.id) {
    await chrome.tabs.update(match.id, { active: true, url: sourceUrl });
    await waitForTabComplete(match.id);
    return { tabId: match.id, origin };
  }
  const tab = await chrome.tabs.create({ url: sourceUrl, active: true });
  if (!tab.id) throw new Error("Could not open host form tab.");
  await waitForTabComplete(tab.id);
  return { tabId: tab.id, origin };
}

async function runHostSubmitJob(job: ExtensionHostSubmitJob): Promise<void> {
  let tabId: number | null = null;
  try {
    const opened = await openFormTab(job.sourceUrl);
    tabId = opened.tabId;
    await trackExtensionFormTab({
      applicationId: job.applicationId,
      origin: opened.origin,
      tabId,
    });

    let pageIndex = 0;
    let totalFilled = 0;
    let lastHighlighted = 0;

    for (let step = 0; step < 12; step += 1) {
      const result = await runBatchFillOnTab({
        tabId,
        origin: opened.origin,
        applicationId: job.applicationId,
        pageIndex,
        resumeFill: true,
        autoContinue: true,
        hostSubmitAllowed: job.clickFinalSubmit,
      });
      totalFilled += result.filledCount;
      lastHighlighted = result.highlighted ?? 0;

      if (lastHighlighted > 0 && result.filledCount === 0) {
        await completeHostSubmitJob({
          jobId: job.jobId,
          filledFields: totalFilled,
          pausedForNeedsYou: true,
          missingRequired: [`${lastHighlighted} empty field(s) on page ${pageIndex + 1}`],
        });
        return;
      }

      // Try Next; if none and submit job, click Submit.
      const advance = (await sendToTab<{ clicked: boolean; reason?: string }>(tabId, {
        type: "TRY_AUTO_ADVANCE",
      }).catch(() => ({ clicked: false, reason: "error" }))) as {
        clicked: boolean;
        reason?: string;
      };

      if (advance.clicked && advance.reason !== "no-change") {
        pageIndex += 1;
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }

      if (!job.clickFinalSubmit) {
        await completeHostSubmitJob({
          jobId: job.jobId,
          filledFields: totalFilled,
          pausedForNeedsYou: lastHighlighted > 0,
          missingRequired: lastHighlighted > 0 ? [`${lastHighlighted} empty field(s)`] : undefined,
        });
        return;
      }

      const submit = (await sendToTab<{
        clicked: boolean;
        confirmed?: boolean;
        reason?: string;
      }>(tabId, {
        type: "CLICK_HOST_SUBMIT",
        hostSubmitAllowed: true,
      })) as { clicked: boolean; confirmed?: boolean; reason?: string };

      await completeHostSubmitJob({
        jobId: job.jobId,
        filledFields: totalFilled,
        submitted: Boolean(submit.confirmed),
        hostSubmitClicked: Boolean(submit.clicked),
        error: submit.confirmed
          ? undefined
          : submit.clicked
            ? "Submit clicked but host did not confirm."
            : submit.reason || "Could not find Submit on the host form.",
      });
      return;
    }

    await completeHostSubmitJob({
      jobId: job.jobId,
      filledFields: totalFilled,
      submitted: false,
      hostSubmitClicked: false,
      error: "Stopped after too many form pages.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Host job failed.";
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
    await completeHostSubmitJob({
      jobId: job.jobId,
      filledFields: 0,
      submitted: false,
      hostSubmitClicked: false,
      blockedReason: code === "captcha" || code === "account" ? message : undefined,
      error: code === "captcha" || code === "account" ? undefined : message,
    }).catch(() => undefined);
  }
}

let hostJobPollRunning = false;

async function pollAndRunHostSubmitJobs(): Promise<void> {
  if (hostJobPollRunning) return;
  hostJobPollRunning = true;
  try {
    const jobs = await fetchPendingHostSubmitJobs();
    for (const job of jobs) {
      await runHostSubmitJob(job);
    }
  } catch {
    // Not signed in / API unreachable — try again on next alarm.
  } finally {
    hostJobPollRunning = false;
  }
}

const HOST_SUBMIT_ALARM = "poll-host-submit-jobs";

function ensureHostSubmitAlarm(): void {
  chrome.alarms.create(HOST_SUBMIT_ALARM, { periodInMinutes: 1, delayInMinutes: 0.2 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureHostSubmitAlarm();
});

ensureHostSubmitAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HOST_SUBMIT_ALARM) {
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
