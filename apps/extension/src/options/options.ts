import { loadSession, saveSession } from "../api/client";

const appUrl = document.getElementById("appUrl") as HTMLInputElement;
const token = document.getElementById("token") as HTMLInputElement;
const logEl = document.getElementById("log")!;

async function hydrate() {
  const session = await loadSession();
  appUrl.value = session.appBaseUrl;
  token.value = session.deviceToken;
}

document.getElementById("save")!.addEventListener("click", async () => {
  await saveSession({ appBaseUrl: appUrl.value, deviceToken: token.value.trim() });
  logEl.textContent = "Saved. The token stays in this browser profile only.";
});

void hydrate();
