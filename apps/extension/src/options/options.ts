import { loadSession, saveSession } from "../api/client";
import { isPrivilegedJwt } from "../shared/jwt";

const appUrl = document.getElementById("appUrl") as HTMLInputElement;
const token = document.getElementById("token") as HTMLInputElement;
const logEl = document.getElementById("log")!;

async function hydrate() {
  const session = await loadSession();
  appUrl.value = session.appBaseUrl;
  token.value = session.deviceToken;
}

document.getElementById("save")!.addEventListener("click", async () => {
  const deviceToken = token.value.trim();
  if (deviceToken && isPrivilegedJwt(deviceToken)) {
    logEl.textContent = "That token is privileged and cannot be stored in the extension.";
    return;
  }
  await saveSession({ appBaseUrl: appUrl.value, deviceToken });
  logEl.textContent = "Saved. Use a user session token, never a service-role key.";
});

void hydrate();
