"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/cn";

type EphemeralToastContextValue = {
  showToast: (message: string, durationMs?: number) => void;
};

const EphemeralToastContext = createContext<EphemeralToastContextValue>({
  showToast: () => {},
});

export function useEphemeralToast() {
  return useContext(EphemeralToastContext);
}

export function EphemeralToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((nextMessage: string, durationMs = 2600) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setMessage(nextMessage);
    setVisible(true);
    hideTimer.current = setTimeout(() => {
      setVisible(false);
      hideTimer.current = setTimeout(() => setMessage(null), 220);
    }, durationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <EphemeralToastContext.Provider value={{ showToast }}>
      {children}
      {message ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "pointer-events-none fixed bottom-6 left-1/2 z-[100] w-[min(92vw,28rem)] -translate-x-1/2 rounded-2xl border border-teal-200 bg-teal-50/95 px-4 py-3 text-sm leading-5 text-teal-950 shadow-lg backdrop-blur-sm transition-all duration-200",
            visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
          )}
        >
          {message}
        </div>
      ) : null}
    </EphemeralToastContext.Provider>
  );
}
