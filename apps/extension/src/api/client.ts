import { defaultAppBaseUrl, STORAGE_KEYS } from "../shared/messages";

export type SessionState = {
  appBaseUrl: string;
  deviceToken: string;
};

export async function loadSession(): Promise<SessionState> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.appBaseUrl, STORAGE_KEYS.deviceToken]);
  return {
    appBaseUrl: String(stored[STORAGE_KEYS.appBaseUrl] || defaultAppBaseUrl()).replace(/\/$/, ""),
    deviceToken: String(stored[STORAGE_KEYS.deviceToken] || ""),
  };
}

export async function saveSession(partial: Partial<SessionState>): Promise<void> {
  const current = await loadSession();
  await chrome.storage.local.set({
    [STORAGE_KEYS.appBaseUrl]: (partial.appBaseUrl ?? current.appBaseUrl).replace(/\/$/, ""),
    [STORAGE_KEYS.deviceToken]: partial.deviceToken ?? current.deviceToken,
  });
}

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await loadSession();
  if (!session.deviceToken) {
    throw new ExtensionApiError("UNAUTHENTICATED", "Connect the extension in Options with a pairing token from 1-Apply Settings.");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.deviceToken}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${session.appBaseUrl}${path}`, { ...init, headers });
  const json = (await response.json()) as Envelope<T>;
  if (!response.ok || json.error || json.data == null) {
    throw new ExtensionApiError(json.error?.code ?? "REQUEST_FAILED", json.error?.message ?? "Request failed.");
  }
  return json.data;
}

export function ingestOpportunity(input: {
  url: string;
  title?: string;
  excerpt?: string;
  pageText?: string;
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
    }),
  });
}

export function createFillPlan(input: {
  applicationId: string;
  origin: string;
  fields: unknown[];
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
      approvalState: string;
      sensitive: boolean;
      excludedByDefault: boolean;
      reason: string;
      fieldType: string;
    }>;
  }>(`/api/applications/${input.applicationId}/fill-plan`, {
    method: "POST",
    body: JSON.stringify({ origin: input.origin, fields: input.fields }),
  });
}

export function fetchSession() {
  return request<{ email: string; connected: true }>("/api/extension/session");
}

export function listApplications() {
  return request<Array<{ id: string; title: string; organization: string | null }>>("/api/extension/applications");
}
