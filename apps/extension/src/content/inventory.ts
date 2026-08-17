export {};

chrome.runtime.sendMessage({ type: "ping" }, () => undefined);
