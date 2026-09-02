"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import {
  removeApplicationFromNeedsYouQueue,
  removeItemFromNeedsYouQueue,
} from "@/lib/needs-you-queue-client";
import { fetchNeedsYouQueueAction } from "@/server/needs-you/actions";
import type { NeedsYouQueue } from "@/server/needs-you/queries";

type NeedsYouQueueContextValue = {
  queue: NeedsYouQueue;
  onItemResolved: (itemId: string) => void;
  onApplicationRemoved: (applicationId: string) => void;
  refreshQueue: () => Promise<void>;
};

const NeedsYouQueueContext = createContext<NeedsYouQueueContextValue | null>(null);

export function NeedsYouQueueProvider({
  initialData,
  children,
}: {
  initialData: NeedsYouQueue;
  children: ReactNode;
}) {
  const router = useRouter();
  const [queue, setQueue] = useState(initialData);

  useEffect(() => {
    setQueue(initialData);
  }, [initialData]);

  const onItemResolved = useCallback((itemId: string) => {
    setQueue((current) => removeItemFromNeedsYouQueue(current, itemId));
  }, []);

  const onApplicationRemoved = useCallback((applicationId: string) => {
    setQueue((current) => removeApplicationFromNeedsYouQueue(current, applicationId));
  }, []);

  const refreshQueue = useCallback(async () => {
    try {
      const next = await fetchNeedsYouQueueAction();
      setQueue(next);
    } catch {
      router.refresh();
    }
  }, [router]);

  const value = useMemo(
    () => ({ queue, onItemResolved, onApplicationRemoved, refreshQueue }),
    [queue, onItemResolved, onApplicationRemoved, refreshQueue],
  );

  return <NeedsYouQueueContext.Provider value={value}>{children}</NeedsYouQueueContext.Provider>;
}

export function useNeedsYouQueue() {
  const value = useContext(NeedsYouQueueContext);
  if (!value) {
    throw new Error("useNeedsYouQueue must be used within NeedsYouQueueProvider");
  }
  return value;
}
