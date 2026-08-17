declare const chrome: {
  runtime: {
    onInstalled: { addListener: (callback: () => void) => void };
    onMessage: {
      addListener: (
        callback: (message: { type?: string }, sender: unknown, sendResponse: (value: unknown) => void) => boolean | void,
      ) => void;
    };
    sendMessage: (message: unknown, response?: (value: unknown) => void) => void;
  };
};
