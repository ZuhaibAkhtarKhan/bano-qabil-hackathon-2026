declare const chrome: {
  runtime: {
    id: string;
    onInstalled: { addListener: (callback: () => void) => void };
    onMessage: {
      addListener: (
        callback: (
          message: { type?: string; [key: string]: unknown },
          sender: { id?: string; tab?: { id?: number; url?: string } },
          sendResponse: (value: unknown) => void,
        ) => boolean | void,
      ) => void;
    };
    sendMessage: (message: unknown, response?: (value: unknown) => void) => void;
    lastError?: { message: string };
    openOptionsPage: () => void;
  };
  storage: {
    local: {
      get: (keys: string[]) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (keys: string | string[]) => Promise<void>;
    };
  };
  tabs: {
    query: (query: Record<string, unknown>) => Promise<Array<chrome.tabs.Tab>>;
    get: (tabId: number) => Promise<chrome.tabs.Tab>;
    create: (props: { url: string; active?: boolean }) => Promise<chrome.tabs.Tab>;
    update: (tabId: number, props: { active?: boolean; url?: string }) => Promise<chrome.tabs.Tab>;
    sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
    onUpdated: {
      addListener: (
        callback: (tabId: number, info: { status?: string; url?: string }, tab?: chrome.tabs.Tab) => void,
      ) => void;
      removeListener: (
        callback: (tabId: number, info: { status?: string; url?: string }, tab?: chrome.tabs.Tab) => void,
      ) => void;
    };
    onRemoved: {
      addListener: (callback: (tabId: number, removeInfo?: { windowId?: number; isWindowClosing?: boolean }) => void) => void;
    };
  };
  scripting: {
    executeScript: (injection: {
      target: { tabId: number; allFrames?: boolean };
      files?: string[];
      func?: (...args: never[]) => unknown;
      args?: unknown[];
    }) => Promise<Array<{ result?: unknown }>>;
  };
  permissions: {
    contains: (permissions: { origins?: string[] }) => Promise<boolean>;
    request: (permissions: { origins?: string[] }) => Promise<boolean>;
  };
  cookies: {
    getAll: (details: { url: string }) => Promise<Array<{ name: string; value: string }>>;
  };
};

declare namespace chrome {
  namespace tabs {
    type Tab = { id?: number; url?: string; title?: string; status?: string };
  }
}
