declare const chrome: {
  runtime: {
    onInstalled: { addListener: (callback: () => void) => void };
    onMessage: {
      addListener: (
        callback: (
          message: { type?: string; [key: string]: unknown },
          sender: unknown,
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
    };
  };
  tabs: {
    query: (query: { active: boolean; currentWindow: boolean }) => Promise<Array<{ id?: number; url?: string; title?: string }>>;
    sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
    Tab: { id?: number; url?: string; title?: string };
  };
  scripting: {
    executeScript: (injection: { target: { tabId: number }; files: string[] }) => Promise<unknown>;
  };
  permissions: {
    request: (permissions: { origins?: string[] }) => Promise<boolean>;
  };
};

declare namespace chrome {
  namespace tabs {
    type Tab = { id?: number; url?: string; title?: string };
  }
}
