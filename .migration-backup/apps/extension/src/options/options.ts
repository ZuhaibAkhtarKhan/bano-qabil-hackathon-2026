import { APP_BASE_URL } from "../shared/messages";
import { connectWithWebsiteSession } from "../api/client";

const logEl = document.getElementById("log")!;

document.getElementById("connect")!.addEventListener("click", async () => {
  logEl.textContent = `Connecting to ${APP_BASE_URL}… stay signed in on 1-Apply.`;
  try {
    const session = await connectWithWebsiteSession();
    logEl.textContent = `Connected as ${session.email}. Save, scan, and fill will use this browser’s 1-Apply session.`;
  } catch (error) {
    logEl.textContent = error instanceof Error ? error.message : "Could not connect.";
  }
});
