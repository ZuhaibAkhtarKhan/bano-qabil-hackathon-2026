import { matchApplicationByUrl } from "@1apply/domain/url-match";

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
};

type ApplicationOption = {
  id: string;
  title: string;
  organization: string | null;
  sourceUrl: string | null;
  canonicalUrl: string | null;
};

const statusEl = document.getElementById("status")!;
const hazardEl = document.getElementById("hazard")!;
const logEl = document.getElementById("log")!;
const matchEl = document.getElementById("match")!;
const applicationEl = document.getElementById("application") as HTMLSelectElement;

let cachedApps: ApplicationOption[] = [];

function log(text: string) {
  logEl.textContent = text;
}

function send<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else if (response && typeof response === "object" && "error" in response && (response as { error?: string }).error)
        reject(new Error((response as { error: string }).error));
      else resolve(response as T);
    });
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No active tab.");
  return tab;
}

/** Must run in the click handler (user gesture) — Chrome forbids permissions.request otherwise. */
async function ensureSiteAccessFromGesture(tabUrl: string): Promise<string> {
  const parsed = new URL(tabUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Open a public http(s) page first.");
  }
  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1") {
    throw new Error("Local pages cannot be ingested or filled.");
  }
  const origins = [`${parsed.origin}/*`];
  const already = await chrome.permissions.contains({ origins });
  if (already) return parsed.origin;
  const granted = await chrome.permissions.request({ origins });
  if (!granted) {
    throw new Error("Allow access to this site so 1-Apply can fill the current page.");
  }
  return parsed.origin;
}

function selectApplicationForUrl(pageUrl: string | null): ApplicationOption | null {
  if (!pageUrl || !cachedApps.length) {
    matchEl.textContent = "";
    return null;
  }
  const matched = matchApplicationByUrl(pageUrl, cachedApps);
  if (matched) {
    applicationEl.value = matched.id;
    matchEl.textContent = `Matched from this page URL · ${matched.title}`;
    return matched;
  }
  matchEl.textContent = "No saved application matches this URL — Save to 1-Apply first, or pick one.";
  return null;
}

async function refreshSession() {
  try {
    const session = await send<{ email: string }>({ type: "SESSION" });
    statusEl.textContent = `Connected as ${session.email}. Tap Fill from memory on each form step — server automation handles deadlines.`;
    cachedApps = await send<ApplicationOption[]>({ type: "LIST_APPLICATIONS" });
    applicationEl.innerHTML = cachedApps
      .map(
        (item) =>
          `<option value="${item.id}">${escapeHtml(item.title)}${item.organization ? ` · ${escapeHtml(item.organization)}` : ""}</option>`,
      )
      .join("");
    if (cachedApps.length === 0) {
      applicationEl.innerHTML = `<option value="">Save a page first</option>`;
      matchEl.textContent = "";
    } else {
      const tab = await activeTab().catch(() => null);
      selectApplicationForUrl(tab?.url ?? null);
    }
  } catch (error) {
    statusEl.textContent =
      error instanceof Error
        ? error.message
        : "Not connected. Sign in to 1-Apply, then Options → Connect with website session.";
  }
}

document.getElementById("save")!.addEventListener("click", async () => {
  log("Saving current URL to 1-Apply…");
  try {
    const tab = await activeTab();
    await ensureSiteAccessFromGesture(tab.url!);
    const result = await send<{ applicationId: string; duplicate: boolean }>({ type: "SAVE_PAGE" });
    log(result.duplicate ? "This website is already added." : "Saved. Analysis will run in 1-Apply.");
    await refreshSession();
    if (result.applicationId) applicationEl.value = result.applicationId;
  } catch (error) {
    log(error instanceof Error ? error.message : "Save failed.");
  }
});

document.getElementById("fill")!.addEventListener("click", async () => {
  log("Filling matched fields from Application Memory…");
  try {
    const tab = await activeTab();
    await ensureSiteAccessFromGesture(tab.url!);

    if (!cachedApps.length) {
      cachedApps = await send<ApplicationOption[]>({ type: "LIST_APPLICATIONS" });
    }
    const matched = selectApplicationForUrl(tab.url ?? null);
    const applicationId = matched?.id || applicationEl.value;
    if (!applicationId) {
      log("Save this page to 1-Apply first so we can match the application by URL.");
      return;
    }

    const origin = new URL(tab.url!).origin;
    try {
      const result = await send<{
        filled?: Array<{ filled?: boolean; hasAlternates?: boolean }>;
        highlighted?: number;
        filledCount?: number;
      }>({
        type: "SCAN_AND_FILL_BATCH",
        applicationId,
        origin,
        pageIndex: 0,
      });
      const filled = result.filledCount ?? result.filled?.filter((item) => item.filled).length ?? 0;
      const highlighted = result.highlighted ?? 0;
      log(
        `Filled ${filled} on this page. Click Next yourself, then tap Fill again for the next step. ${
          highlighted ? `${highlighted} still empty — highlighted for Need You.` : "Submit stays manual unless auto-submit is on in Settings."
        }`,
      );
      return;
    } catch {
      // Fall back to the existing per-field fill-plan + 1A chip path.
    }

    const inventory = await send<{
      fields: unknown[];
      url: string;
      title: string;
      tabId: number;
      origin: string;
      hazards?: {
        captcha?: boolean;
        captchaMessage?: string | null;
        accountCreation?: boolean;
        accountMessage?: string | null;
        unsupported?: boolean;
        unsupportedReason?: string | null;
      };
    }>({ type: "SCAN_FORM" });
    const hazard = inventory.hazards;
    const messages = [hazard?.captchaMessage, hazard?.accountMessage, hazard?.unsupportedReason].filter(Boolean);
    hazardEl.textContent = messages.join(" ");
    hazardEl.classList.toggle("hidden", messages.length === 0);

    if (!cachedApps.length) {
      cachedApps = await send<ApplicationOption[]>({ type: "LIST_APPLICATIONS" });
    }
    const fallbackMatch = selectApplicationForUrl(inventory.url);
    const fallbackApplicationId = fallbackMatch?.id || applicationEl.value || applicationId;
    if (!fallbackApplicationId) {
      log("Save this page to 1-Apply first so we can match the application by URL.");
      return;
    }

    const plan = await send<{ mappings: Mapping[]; fillSessionId?: string }>({
      type: "CREATE_FILL_PLAN",
      applicationId: fallbackApplicationId,
      origin: inventory.origin || new URL(inventory.url).origin,
      fields: inventory.fields,
      hazards: inventory.hazards,
    });

    const result = await send<{
      filled: Array<{ fieldKey: string; filled: boolean; hasAlternates?: boolean; skippedReason?: string }>;
      highlighted?: number;
    }>({
      type: "APPLY_SUGGESTIONS",
      applicationId: fallbackApplicationId,
      fillSessionId: plan.fillSessionId,
      mappings: plan.mappings,
      highlightKeys: (inventory.fields as Array<{ key?: string }>).map((field) => String(field.key ?? "")).filter(Boolean),
      origin: inventory.origin || new URL(inventory.url).origin,
      tabId: inventory.tabId,
    });

    const filled = result.filled?.filter((item) => item.filled) ?? [];
    const chips = result.filled?.filter((item) => item.hasAlternates).length ?? 0;
    const highlighted = result.highlighted ?? 0;
    const aiCount = plan.mappings.filter((item) => item.aiAnswerable).length;
    log(
      `Filled ${filled.length} on this page. Click Next yourself, then tap Fill again. ${aiCount ? `${aiCount} AI assistant(s) — tap 1A on the page, Generate, Confirm. ` : ""}${
        chips && !aiCount ? `${chips} chip(s) for alternates. ` : ""
      }${highlighted ? `${highlighted} still empty — highlighted.` : "Submit stays manual unless auto-submit is on in Settings."}`,
    );
  } catch (error) {
    log(error instanceof Error ? error.message : "Fill failed.");
  }
});

document.getElementById("options")!.addEventListener("click", () => chrome.runtime.openOptionsPage());

applicationEl.addEventListener("change", () => {
  matchEl.textContent = "Using the application you selected.";
});

void refreshSession();
