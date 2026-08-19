import { createFillPlan, fetchSession, ingestOpportunity, listApplications } from "../api/client";
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
  approvalState: string;
  sensitive: boolean;
  excludedByDefault: boolean;
  reason: string;
  fieldType: string;
};

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

async function ensureContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
}

async function sendToTab<T>(tabId: number, message: unknown): Promise<T> {
  await ensureContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
}

chrome.runtime.onInstalled.addListener(() => {
  console.info("1-Apply extension installed. Fill is user-invoked and never submits.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id && sender.id !== chrome.runtime.id) {
    sendResponse({ error: "Unknown sender." });
    return false;
  }

  const task = (async () => {
    if (message?.type === "PING") return { ok: true, neverSubmit: true };
    if (message?.type === "SESSION") return fetchSession();
    if (message?.type === "LIST_APPLICATIONS") return listApplications();

    if (message?.type === "SAVE_PAGE") {
      const tab = await activeTab();
      if (!tab.id) throw new Error("No active tab.");
      const origin = tabOrigin(tab);
      const meta = await sendToTab<{ url: string; title: string; excerpt: string }>(tab.id, { type: "GET_PAGE_META" });
      const pageUrl = meta.url || tab.url || "";
      if (new URL(pageUrl).origin !== origin) {
        throw new Error("Page origin changed. Refresh and try again.");
      }
      return ingestOpportunity({
        url: pageUrl,
        title: meta.title || tab.title || undefined,
        excerpt: meta.excerpt,
        pageText: meta.excerpt,
      });
    }

    if (message?.type === "SCAN_FORM") {
      const tab = await activeTab();
      if (!tab.id) throw new Error("No active tab.");
      const origin = tabOrigin(tab);
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

    if (message?.type === "FILL_APPROVED") {
      const tab = await activeTab();
      if (!tab.id) throw new Error("No active tab.");
      const origin = tabOrigin(tab);
      const expectedOrigin = String(message.origin ?? "");
      const expectedTabId = Number(message.tabId);
      if (!expectedOrigin || origin !== expectedOrigin) {
        throw new Error("Page origin changed. Scan this page again.");
      }
      if (expectedTabId && expectedTabId !== tab.id) {
        throw new Error("Active tab changed. Scan this page again.");
      }
      const mappings = (message.mappings as Mapping[]).filter((item) => item.approvalState === "approved" && item.proposedValue);
      return sendToTab(tab.id, {
        type: "FILL",
        origin,
        mappings: mappings.map((item) => ({ fieldKey: item.fieldKey, value: item.proposedValue, type: item.fieldType })),
      });
    }

    throw new Error("Unknown message.");
  })();

  task.then(sendResponse).catch((error: Error) => sendResponse({ error: error.message }));
  return true;
});
