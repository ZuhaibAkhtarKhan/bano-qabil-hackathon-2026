import {
  connectWithWebsiteSession,
  createFillPlan,
  fetchDocumentFile,
  fetchSession,
  generateAiDraft,
  ingestOpportunity,
  listApplications,
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
};

const FILL_SESSION_KEY = "fillSession";
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const autoFillInFlight = new Set<number>();

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

async function ensureHostAccess(origin: string): Promise<void> {
  const origins = [`${origin}/*`];
  const already = await chrome.permissions.contains({ origins });
  if (already) return;
  throw new Error(
    "Site access is missing. Click Fill/Save in the 1-Apply popup once and allow access when Chrome asks.",
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

async function applyMappingsToTab(input: {
  tabId: number;
  origin: string;
  applicationId: string;
  mappings: Mapping[];
  highlightKeys?: string[];
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
    autoContinue: true,
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

async function continueFillOnTab(tabId: number): Promise<{ ok: boolean; reason?: string; filled?: number }> {
  if (autoFillInFlight.has(tabId)) return { ok: false, reason: "busy" };
  const session = await loadFillSession();
  if (!session) return { ok: false, reason: "no-session" };

  const tab = await chrome.tabs.get(tabId);
  let origin: string;
  try {
    origin = tabOrigin(tab);
  } catch (error) {
    // During navigation the URL can be briefly unavailable — do not kill the session.
    return { ok: false, reason: error instanceof Error ? error.message : "bad-tab" };
  }
  if (origin !== session.origin) return { ok: false, reason: "origin-mismatch" };

  autoFillInFlight.add(tabId);
  try {
    await ensureHostAccess(origin).catch(() => undefined);
    await ensureContentScript(tabId);

    // Next-step UIs (Google Forms) often paint fields after the click; retry briefly.
    let inventory: InventoryResponse | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
      try {
        inventory = await sendToTab<InventoryResponse>(tabId, { type: "INVENTORY" });
      } catch {
        inventory = null;
      }
      if (inventory?.fields?.length) break;
    }
    if (!inventory?.fields?.length) return { ok: false, reason: "no-fields" };

    const plan = await createFillPlan({
      applicationId: session.applicationId,
      origin,
      fields: inventory.fields,
    });

    const result = (await applyMappingsToTab({
      tabId,
      origin,
      applicationId: session.applicationId,
      mappings: plan.mappings as Mapping[],
      highlightKeys: inventory.fields.map((field) => field.key),
    })) as { filled?: Array<{ filled?: boolean }> };

    await saveFillSession({ ...session, tabId, origin, updatedAt: Date.now(), enabled: true });
    const filled = result.filled?.filter((item) => item.filled).length ?? 0;
    return { ok: true, filled };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "continue-failed" };
  } finally {
    autoFillInFlight.delete(tabId);
  }
}

async function clearFillSession(tabId?: number): Promise<void> {
  const session = await loadFillSession();
  if (!session) return;
  if (tabId != null && session.tabId !== tabId) return;
  await chrome.storage.local.remove(FILL_SESSION_KEY);
  if (session.tabId) {
    try {
      await sendToTab(session.tabId, { type: "STOP_AUTO_CONTINUE" });
    } catch {
      // Tab may already be gone.
    }
  }
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  // Keep filling across soft and hard navigations while a session is active.
  if (info.status && info.status !== "complete" && !info.url) return;
  void (async () => {
    const session = await loadFillSession();
    if (!session || session.tabId !== tabId) return;

    if (info.status === "loading") return;

    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("about:")) return;
      const origin = tabOrigin(tab);
      if (origin !== session.origin) {
        // Only clear when the user clearly left the site.
        if (info.status === "complete") await clearFillSession(tabId);
        return;
      }
    } catch {
      // Transient get failures during navigation — keep session and try again later.
      return;
    }

    // Small delay so SPA step content can mount after history/URL updates.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await continueFillOnTab(tabId);
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearFillSession(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const task = (async () => {
    if (message?.type === "SESSION") return fetchSession();
    if (message?.type === "CONNECT_WEBSITE") return connectWithWebsiteSession();
    if (message?.type === "LIST_APPLICATIONS") return listApplications();
    if (message?.type === "FILL_SESSION_STATUS") {
      const session = await loadFillSession();
      if (!session) return { active: false };
      return { active: true, origin: session.origin, tabId: session.tabId, applicationId: session.applicationId };
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

    if (message?.type === "AUTO_CONTINUE_FILL") {
      const tabId = sender.tab?.id;
      if (!tabId) throw new Error("No tab for auto-continue.");
      return continueFillOnTab(tabId);
    }

    if (message?.type === "STOP_FILL_SESSION") {
      const session = await loadFillSession();
      await chrome.storage.local.remove(FILL_SESSION_KEY);
      if (session?.tabId) {
        try {
          await sendToTab(session.tabId, { type: "STOP_AUTO_CONTINUE" });
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
      return ingestOpportunity({
        url: pageUrl,
        title: meta.title || tab.title || undefined,
        excerpt: meta.excerpt,
        pageText: meta.pageText || meta.excerpt,
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

    if (message?.type === "CREATE_FILL_PLAN") {
      return createFillPlan({
        applicationId: String(message.applicationId),
        origin: String(message.origin ?? ""),
        fields: message.fields as unknown[],
      });
    }

    if (message?.type === "APPLY_SUGGESTIONS" || message?.type === "FILL_APPROVED") {
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
      if (applicationId) {
        await saveFillSession({
          applicationId,
          origin,
          tabId: tab.id,
          enabled: true,
          updatedAt: Date.now(),
        });
      }

      return applyMappingsToTab({
        tabId: tab.id,
        origin,
        applicationId,
        mappings: message.mappings as Mapping[],
        highlightKeys: Array.isArray(message.highlightKeys) ? (message.highlightKeys as string[]) : undefined,
      });
    }

    throw new Error("Unknown message.");
  })();

  task.then(sendResponse).catch((error: Error) => sendResponse({ error: error.message }));
  return true;
});
