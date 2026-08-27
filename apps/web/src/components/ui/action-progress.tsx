"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ActionProgressContextValue = {
  pendingCount: number;
  navigationPending: boolean;
  beginAction: () => void;
  endAction: () => void;
  beginNavigation: () => void;
  endNavigation: () => void;
};

const ActionProgressContext = createContext<ActionProgressContextValue>({
  pendingCount: 0,
  navigationPending: false,
  beginAction: () => {},
  endAction: () => {},
  beginNavigation: () => {},
  endNavigation: () => {},
});

export function useActionProgress() {
  return useContext(ActionProgressContext);
}

function syncNavPendingClass(active: boolean) {
  if (active) {
    document.documentElement.classList.add("nav-pending");
  } else {
    document.documentElement.classList.remove("nav-pending");
  }
}

/** Tracks in-flight form / async button work so the global progress bar can show. */
export function ActionProgressProvider({ children }: { children: ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);
  const [navigationPending, setNavigationPending] = useState(false);
  const pendingRef = useRef(0);
  pendingRef.current = pendingCount;

  const beginAction = useCallback(() => {
    setPendingCount((count) => count + 1);
  }, []);

  const endAction = useCallback(() => {
    setPendingCount((count) => Math.max(0, count - 1));
  }, []);

  const beginNavigation = useCallback(() => {
    setNavigationPending(true);
  }, []);

  const endNavigation = useCallback(() => {
    setNavigationPending(false);
  }, []);

  useEffect(() => {
    syncNavPendingClass(pendingCount > 0 || navigationPending);
  }, [pendingCount, navigationPending]);

  // Any form submit should keep the bar visible until navigation settles or the action finishes.
  useEffect(() => {
    const onSubmit = () => beginNavigation();
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, [beginNavigation]);

  // Same-page server actions (no URL change): clear navigation pending once work completes.
  useEffect(() => {
    if (pendingCount !== 0 || !navigationPending) return;
    const id = window.setTimeout(() => {
      if (pendingRef.current === 0) setNavigationPending(false);
    }, 700);
    return () => window.clearTimeout(id);
  }, [pendingCount, navigationPending]);

  const value = useMemo(
    () => ({
      pendingCount,
      navigationPending,
      beginAction,
      endAction,
      beginNavigation,
      endNavigation,
    }),
    [pendingCount, navigationPending, beginAction, endAction, beginNavigation, endNavigation],
  );

  return <ActionProgressContext.Provider value={value}>{children}</ActionProgressContext.Provider>;
}

/** Syncs `useFormStatus().pending` (or any boolean) into the global action progress bar. */
export function useReportActionPending(pending: boolean) {
  const { beginAction, endAction } = useActionProgress();
  const wasPending = useRef(false);

  useEffect(() => {
    if (pending && !wasPending.current) {
      beginAction();
      wasPending.current = true;
    } else if (!pending && wasPending.current) {
      endAction();
      wasPending.current = false;
    }
  }, [pending, beginAction, endAction]);

  useEffect(() => {
    return () => {
      if (wasPending.current) {
        endAction();
        wasPending.current = false;
      }
    };
  }, [endAction]);
}
