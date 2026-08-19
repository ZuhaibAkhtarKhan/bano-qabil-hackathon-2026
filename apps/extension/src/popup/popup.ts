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

const statusEl = document.getElementById("status")!;
const hazardEl = document.getElementById("hazard")!;
const logEl = document.getElementById("log")!;
const rowsEl = document.getElementById("rows")!;
const previewEl = document.getElementById("preview")!;
const applicationEl = document.getElementById("application") as HTMLSelectElement;

let mappings: Mapping[] = [];
let lastFields: unknown[] = [];
let lastOrigin = "";
let lastTabId = 0;

function log(text: string) {
  logEl.textContent = text;
}

function send<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else if (response && typeof response === "object" && "error" in response && (response as { error?: string }).error) reject(new Error((response as { error: string }).error));
      else resolve(response as T);
    });
  });
}

function renderMappings() {
  rowsEl.innerHTML = "";
  previewEl.classList.toggle("hidden", mappings.length === 0);
  for (const mapping of mappings) {
    const card = document.createElement("article");
    card.className = "card";
    const percent = Math.round(mapping.confidence * 100);
    card.innerHTML = `
      <header>
        <div>
          <strong>${escapeHtml(mapping.label || mapping.fieldKey)}</strong>
          <div class="meta">${escapeHtml(mapping.proposedValue || "—")}</div>
        </div>
        <div class="meta">${escapeHtml(mapping.source)} · ${percent}%</div>
      </header>
      <p class="meta">${escapeHtml(mapping.memoryPath)} — ${escapeHtml(mapping.reason)}</p>
    `;
    const label = document.createElement("label");
    label.className = "approve";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.disabled = mapping.approvalState === "blocked" && mapping.sensitive === false && mapping.fieldType === "file";
    box.checked = mapping.approvalState === "approved";
    if (mapping.approvalState === "blocked" && mapping.sensitive) {
      box.disabled = false;
      box.title = "Sensitive — only check this if you explicitly want it filled.";
    }
    if (mapping.fieldType === "file" || mapping.memoryPath === "Blocked") box.disabled = true;
    box.addEventListener("change", () => {
      mapping.approvalState = box.checked ? "approved" : "pending";
    });
    label.append(box, document.createTextNode(mapping.sensitive ? "Explicitly approve sensitive field" : "Approve"));
    card.append(label);
    rowsEl.append(card);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

async function refreshSession() {
  try {
    const session = await send<{ email: string }>({ type: "SESSION" });
    statusEl.textContent = `Connected as ${session.email}. This extension never clicks submit.`;
    const apps = await send<Array<{ id: string; title: string; organization: string | null }>>({ type: "LIST_APPLICATIONS" });
    applicationEl.innerHTML = apps
      .map((item) => `<option value="${item.id}">${escapeHtml(item.title)}${item.organization ? ` · ${escapeHtml(item.organization)}` : ""}</option>`)
      .join("");
    if (apps.length === 0) applicationEl.innerHTML = `<option value="">Save a page first</option>`;
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : "Not connected.";
  }
}

document.getElementById("save")!.addEventListener("click", async () => {
  log("Saving current URL to 1-Apply…");
  try {
    const result = await send<{ applicationId: string; duplicate: boolean }>({ type: "SAVE_PAGE" });
    log(result.duplicate ? "Already in your workspace." : "Saved. Analysis will run in 1-Apply.");
    await refreshSession();
    if (result.applicationId) applicationEl.value = result.applicationId;
  } catch (error) {
    log(error instanceof Error ? error.message : "Save failed.");
  }
});

document.getElementById("scan")!.addEventListener("click", async () => {
  log("Scanning fields…");
  try {
    const inventory = await send<{
      fields: unknown[];
      url: string;
      title: string;
      tabId: number;
      origin: string;
      hazards?: { captcha?: boolean; captchaMessage?: string | null; accountCreation?: boolean; accountMessage?: string | null; unsupported?: boolean; unsupportedReason?: string | null };
    }>({ type: "SCAN_FORM" });
    lastFields = inventory.fields;
    lastOrigin = inventory.origin || new URL(inventory.url).origin;
    lastTabId = inventory.tabId;
    const hazard = inventory.hazards;
    const messages = [hazard?.captchaMessage, hazard?.accountMessage, hazard?.unsupportedReason].filter(Boolean);
    hazardEl.textContent = messages.join(" ");
    hazardEl.classList.toggle("hidden", messages.length === 0);

    const applicationId = applicationEl.value;
    if (!applicationId) {
      mappings = [];
      renderMappings();
      log("Save the page or pick an application to map fields to Application Memory.");
      return;
    }
    const plan = await send<{ mappings: Mapping[] }>({
      type: "CREATE_FILL_PLAN",
      applicationId,
      origin: lastOrigin,
      fields: lastFields,
    });
    mappings = plan.mappings;
    renderMappings();
    log("Review mappings, then approve. 1-Apply will not submit.");
  } catch (error) {
    log(error instanceof Error ? error.message : "Scan failed.");
  }
});

document.getElementById("fill")!.addEventListener("click", async () => {
  try {
    const result = await send<{ filled: Array<{ fieldKey: string; filled: boolean }> }>({
      type: "FILL_APPROVED",
      mappings,
      origin: lastOrigin,
      tabId: lastTabId,
    });
    const count = result.filled?.filter((item) => item.filled).length ?? 0;
    log(`Filled ${count} approved field(s). Submit remains yours.`);
  } catch (error) {
    log(error instanceof Error ? error.message : "Fill failed.");
  }
});

document.getElementById("options")!.addEventListener("click", () => chrome.runtime.openOptionsPage());

void refreshSession();
