import {
  ensureAppHostPermission,
  loadSession,
  openAppSignedIn,
  saveSession,
  type SessionState,
} from "./session";

export { loadSession, saveSession, ensureAppHostPermission, openAppSignedIn } from "./session";
export type { SessionState };

type Envelope<T> = { data: T | null; error: { code: string; message: string } | null; requestId: string };

export class ExtensionApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ExtensionApiError";
  }
}

async function cookieHeaderFor(url: string): Promise<string | null> {
  if (!chrome.cookies?.getAll) return null;
  const cookies = await chrome.cookies.getAll({ url });
  if (!cookies.length) return null;
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function directFetch<T>(session: SessionState, path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const cookie = await cookieHeaderFor(session.appBaseUrl);
  if (cookie) headers.set("Cookie", cookie);

  const response = await fetch(`${session.appBaseUrl}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  const json = (await response.json()) as Envelope<T>;
  if (!response.ok || json.error || json.data == null) {
    throw new ExtensionApiError(json.error?.code ?? "REQUEST_FAILED", json.error?.message ?? "Request failed.");
  }
  return json.data;
}

async function ensureBridge(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["bridge.js"] });
}

async function bridgeFetch<T>(session: SessionState, path: string, init: RequestInit): Promise<T> {
  const origin = new URL(session.appBaseUrl).origin;
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  let tabId = tabs.find((tab) => tab.id)?.id;
  if (!tabId) {
    tabId = await openAppSignedIn(false);
  }
  await ensureBridge(tabId);
  const result = (await chrome.tabs.sendMessage(tabId, {
    type: "BRIDGE_FETCH",
    path,
    method: init.method ?? "GET",
    body: typeof init.body === "string" ? init.body : init.body ? String(init.body) : null,
  })) as { ok: boolean; status: number; json: Envelope<T>; error?: string };

  if (result?.error) {
    throw new ExtensionApiError("BRIDGE_FAILED", result.error);
  }
  if (!result?.ok || result.json?.error || result.json?.data == null) {
    throw new ExtensionApiError(
      result.json?.error?.code ?? "UNAUTHENTICATED",
      result.json?.error?.message ?? "Sign in to 1-Apply in this browser, then try again.",
    );
  }
  return result.json.data;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await loadSession();
  const allowed = await ensureAppHostPermission();
  if (!allowed) {
    throw new ExtensionApiError(
      "HOST_PERMISSION",
      "Allow access to your 1-Apply site in the extension permission prompt.",
    );
  }

  try {
    return await directFetch<T>(session, path, init);
  } catch (error) {
    const shouldBridge =
      !(error instanceof ExtensionApiError) ||
      error.code === "UNAUTHENTICATED" ||
      error.code === "FORBIDDEN" ||
      error.code === "REQUEST_FAILED";
    if (!shouldBridge) throw error;
    try {
      return await bridgeFetch<T>(session, path, init);
    } catch (bridgeError) {
      if (error instanceof ExtensionApiError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")) {
        throw new ExtensionApiError(
          error.code,
          "Sign in to 1-Apply in this browser (same profile), open Options → Connect, then retry.",
        );
      }
      throw bridgeError instanceof Error ? bridgeError : error;
    }
  }
}

export function ingestOpportunity(input: {
  url: string;
  title?: string;
  excerpt?: string;
  pageText?: string;
  formPage?: {
    pageIndex?: number;
    pageUrl?: string;
    pageTitle?: string;
    origin?: string;
    hazards?: unknown;
    fields: unknown[];
  };
}) {
  return request<{
    opportunityId: string;
    applicationId: string;
    jobId: string | null;
    duplicate: boolean;
    analysisStatus: string;
  }>("/api/opportunities/ingest", {
    method: "POST",
    body: JSON.stringify({
      url: input.url,
      source: "extension",
      metadata: {
        title: input.title,
        excerpt: input.excerpt,
        pageText: input.pageText,
        source: "extension",
      },
      ...(input.formPage ? { formPage: input.formPage } : {}),
    }),
  });
}

export function createFillPlan(input: {
  applicationId: string;
  origin: string;
  fields: unknown[];
  hazards?: unknown;
}) {
  return request<{
    fillSessionId: string;
    expiresAt: string;
    hazards: unknown;
    mappings: Array<{
      fieldKey: string;
      label: string;
      memoryPath: string;
      source: string;
      confidence: number;
      proposedValue: string;
      options: Array<{ value: string; label: string; source: string }>;
      approvalState: string;
      sensitive: boolean;
      excludedByDefault: boolean;
      reason: string;
      fieldType: string;
      aiAnswerable: boolean;
      showChip: boolean;
      attachment?: {
        documentId: string;
        versionId: string;
        filename: string;
        mimeType: string;
        byteSize: number;
      } | null;
    }>;
  }>(`/api/applications/${input.applicationId}/fill-plan`, {
    method: "POST",
    body: JSON.stringify({
      origin: input.origin,
      fields: input.fields,
      hazards: input.hazards ?? {},
    }),
  });
}

export function endFillSession(input: {
  applicationId: string;
  reason: "stopped" | "tab_closed" | "origin_left" | "submitted_detected";
  origin?: string;
  fillSessionId?: string;
  pageUrl?: string;
  pageText?: string;
  fields?: Array<{
    fieldKey: string;
    fieldId?: string;
    label?: string;
    value: string;
    required?: boolean;
    fieldType?: string;
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
}) {
  return request<{
    applicationId: string;
    status: string;
    nextAction: string;
    savedFieldCount: number;
    needsYouCount: number;
    submitted: boolean;
    submissionSignal: string | null;
  }>(`/api/applications/${input.applicationId}/fill-session/end`, {
    method: "POST",
    body: JSON.stringify({
      reason: input.reason,
      origin: input.origin,
      fillSessionId: input.fillSessionId,
      pageUrl: input.pageUrl,
      pageText: input.pageText,
      fields: input.fields ?? [],
      ...(input.formPage ? { formPage: input.formPage } : {}),
    }),
  });
}

export function generateAiDraft(input: {
  applicationId: string;
  question: string;
  fieldKey?: string;
  guidance?: string;
  limitValue?: number | null;
  limitUnit?: "words" | "characters" | null;
}) {
  return request<{ draft: string; grounded: boolean; limitApplied?: boolean }>(
    `/api/applications/${input.applicationId}/ai-draft`,
    {
      method: "POST",
      body: JSON.stringify({
        question: input.question,
        fieldKey: input.fieldKey,
        guidance: input.guidance,
        limitValue: input.limitValue ?? null,
        limitUnit: input.limitUnit ?? null,
      }),
    },
  );
}

export function fetchSession() {
  return request<{ email: string; connected: true }>("/api/extension/session");
}

export function listApplications() {
  return request<
    Array<{
      id: string;
      title: string;
      organization: string | null;
      sourceUrl: string | null;
      canonicalUrl: string | null;
    }>
  >("/api/extension/applications");
}

export function createBatchFillPlan(input: {
  applicationId: string;
  pageIndex: number;
  origin?: string;
  fields: unknown[];
}) {
  return request<{
    fields: Array<{
      fieldId: string;
      status: "filled" | "need_you";
      value?: string;
      evidenceIds?: string[];
      documentVersionId?: string;
    }>;
    fillSessionId: string | null;
  }>(`/api/applications/${input.applicationId}/fill-plan/batch`, {
    method: "POST",
    body: JSON.stringify({
      applicationId: input.applicationId,
      pageIndex: input.pageIndex,
      origin: input.origin,
      fields: input.fields,
    }),
  });
}

export function fetchDocumentFile(versionId: string) {
  return request<{
    versionId: string;
    documentId: string;
    filename: string;
    mimeType: string;
    byteSize: number;
    base64: string;
  }>(`/api/extension/documents/${versionId}`);
}

export async function connectWithWebsiteSession() {
  await saveSession();
  const allowed = await ensureAppHostPermission();
  if (!allowed) {
    throw new ExtensionApiError("HOST_PERMISSION", "Permission to access 1-Apply was denied.");
  }
  const tabId = await openAppSignedIn(true);
  await chrome.scripting.executeScript({ target: { tabId }, files: ["bridge.js"] });
  return fetchSession();
}
