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
const sessionEl = document.getElementById("session")!;
const hazardEl = document.getElementById("hazard")!;
const logEl = document.getElementById("log")!;
const matchEl = document.getElementById("match")!;
const stopEl = document.getElementById("stop") as HTMLButtonElement;
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
    throw new Error("Allow access to this site so 1-Apply can fill it and continue on later steps.");
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

async function refreshFillSessionUi() {
  try {
    const session = await send<{ active: boolean; origin?: string }>({ type: "FILL_SESSION_STATUS" });
    if (session.active) {
      sessionEl.textContent = `Filling until you Stop or close the page${session.origin ? ` · ${session.origin}` : ""}.`;
      sessionEl.classList.remove("hidden");
      stopEl.classList.remove("hidden");
    } else {
      sessionEl.textContent = "";
      sessionEl.classList.add("hidden");
      stopEl.classList.add("hidden");
    }
  } catch {
    sessionEl.classList.add("hidden");
    stopEl.classList.add("hidden");
  }
}

async function refreshSession() {
  try {
    const session = await send<{ email: string }>({ type: "SESSION" });
    statusEl.textContent = `Connected as ${session.email}. After Fill, it keeps going on Next until you Stop.`;
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
    await refreshFillSessionUi();
  } catch (error) {
    statusEl.textContent =
      error instanceof Error
        ? error.message
        : "Not connected. Sign in to 1-Apply, then Options → Connect with website session.";
    sessionEl.classList.add("hidden");
    stopEl.classList.add("hidden");
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
    const matched = selectApplicationForUrl(inventory.url);
    let applicationId = matched?.id || applicationEl.value;
    if (!applicationId) {
      log("No saved application matched this URL. Saving the page first…");
      const saved = await send<{ applicationId: string; duplicate?: boolean }>({ type: "SAVE_PAGE" });
      applicationId = saved.applicationId;
      await refreshSession();
      if (applicationId) applicationEl.value = applicationId;
    }
    if (!applicationId) {
      log("Could not save this page. Sign in under Options, then try Fill again.");
      return;
    }

    const plan = await send<{ mappings: Mapping[] }>({
      type: "CREATE_FILL_PLAN",
      applicationId,
      origin: inventory.origin || new URL(inventory.url).origin,
      fields: inventory.fields,
    });

    const result = await send<{
      filled: Array<{ fieldKey: string; filled: boolean; hasAlternates?: boolean; skippedReason?: string }>;
      highlighted?: number;
    }>({
      type: "APPLY_SUGGESTIONS",
      applicationId,
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
      `Filled ${filled.length}. Keeps filling after Next until you Stop. ${aiCount ? `${aiCount} AI assistant(s) — tap 1A on the page, Generate, Confirm. ` : ""}${
        chips && !aiCount ? `${chips} chip(s) for alternates. ` : ""
      }${highlighted ? `${highlighted} still empty — highlighted.` : "Submit remains yours."}`,
    );
    await refreshFillSessionUi();
  } catch (error) {
    log(error instanceof Error ? error.message : "Fill failed.");
  }
});

stopEl.addEventListener("click", async () => {
  try {
    await send({ type: "STOP_FILL_SESSION" });
    log("Stopped. Open the popup and Fill again to resume.");
    await refreshFillSessionUi();
  } catch (error) {
    log(error instanceof Error ? error.message : "Could not stop.");
  }
});

document.getElementById("options")!.addEventListener("click", () => chrome.runtime.openOptionsPage());

applicationEl.addEventListener("change", () => {
  matchEl.textContent = "Using the application you selected.";
});

void refreshSession();
