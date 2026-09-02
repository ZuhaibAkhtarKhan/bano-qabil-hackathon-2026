import { DEFAULT_APP_BASE_URL, resolveAppBaseUrl, saveAppBaseUrl } from "../shared/app-url";
import { connectWithWebsiteSession } from "../api/client";

const logEl = document.getElementById("log")!;
const urlInput = document.getElementById("app-url") as HTMLInputElement;

void resolveAppBaseUrl().then((url) => {
  urlInput.value = url;
});

document.getElementById("save-url")!.addEventListener("click", async () => {
  const next = urlInput.value.trim();
  if (!next) {
    logEl.textContent = "Enter your 1-Apply URL (e.g. http://3.108.122.44).";
    return;
  }
  try {
    await saveAppBaseUrl(next);
    logEl.textContent = `Saved ${next}. Click Connect to grant permission for that origin.`;
  } catch (error) {
    logEl.textContent = error instanceof Error ? error.message : "Could not save URL.";
  }
});

document.getElementById("connect")!.addEventListener("click", async () => {
  const base = await resolveAppBaseUrl();
  logEl.textContent = `Connecting to ${base}… stay signed in on 1-Apply.`;
  try {
    const session = await connectWithWebsiteSession();
    logEl.textContent = `Connected as ${session.email}. Save, scan, and fill will use this browser’s 1-Apply session.`;
  } catch (error) {
    logEl.textContent = error instanceof Error ? error.message : "Could not connect.";
  }
});

void DEFAULT_APP_BASE_URL;
