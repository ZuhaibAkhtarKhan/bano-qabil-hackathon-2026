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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const task = (async () => {
    if (message?.type === "PING") return { ok: true, neverSubmit: true };
    if (message?.type === "SESSION") return fetchSession();
    if (message?.type === "LIST_APPLICATIONS") return listApplications();

    if (message?.type === "SAVE_PAGE") {
      const tab = await activeTab();
      if (!tab.id || !tab.url || tab.url.startsWith("chrome://")) {
        throw new Error("Open a public opportunity page, then try Save to 1-Apply.");
      }
      const meta = await sendToTab<{ url: string; title: string; excerpt: string }>(tab.id, { type: "GET_PAGE_META" });
      return ingestOpportunity({
        url: meta.url || tab.url,
        title: meta.title || tab.title || undefined,
        excerpt: meta.excerpt,
        pageText: meta.excerpt,
      });
    }

    if (message?.type === "SCAN_FORM") {
      const tab = await activeTab();
      if (!tab.id) throw new Error("No active tab.");
      return sendToTab<InventoryResponse>(tab.id, { type: "INVENTORY" });
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
      const mappings = (message.mappings as Mapping[]).filter((item) => item.approvalState === "approved" && item.proposedValue);
      return sendToTab(tab.id, {
        type: "FILL",
        mappings: mappings.map((item) => ({ fieldKey: item.fieldKey, value: item.proposedValue, type: item.fieldType })),
      });
    }

    throw new Error("Unknown message.");
  })();

  task.then(sendResponse).catch((error: Error) => sendResponse({ error: error.message }));
  return true;
});
