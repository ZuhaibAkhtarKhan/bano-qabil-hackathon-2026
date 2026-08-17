chrome.runtime.onInstalled.addListener(() => {
  console.info("1-Apply extension installed. Fill is user-invoked and never submits.");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ping") {
    sendResponse({ ok: true, fillEnabled: false });
  }
  return false;
});
