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
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { markNotificationReadAction } from "@/server/notifications/actions";
import { RealtimeToastContainer, type RealtimeToastItem } from "./realtime-toast";

type RealtimeContextValue = {
  unreadCount: number;
  toasts: RealtimeToastItem[];
  dismissToast: (id: string) => void;
  markNotificationRead: (id: string) => Promise<void>;
  isRealtimeConnected: boolean;
};

const RealtimeContext = createContext<RealtimeContextValue>({
  unreadCount: 0,
  toasts: [],
  dismissToast: () => {},
  markNotificationRead: async () => {},
  isRealtimeConnected: false,
});

export function useRealtime() {
  return useContext(RealtimeContext);
}

export function RealtimeWorkspaceProvider({
  userId,
  initialUnreadCount = 0,
  children,
}: {
  userId: string;
  initialUnreadCount?: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [toasts, setToasts] = useState<RealtimeToastItem[]>([]);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const markNotificationRead = useCallback(async (id: string) => {
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      const fd = new FormData();
      fd.set("notificationId", id);
      await markNotificationReadAction(fd);
    } catch {
      // Best-effort
    }
  }, []);

  const addToast = useCallback((item: RealtimeToastItem) => {
    setToasts((prev) => [item, ...prev.slice(0, 4)]);
    // Auto dismiss after 7 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== item.id));
    }, 7000);
  }, []);

  useEffect(() => {
    let supabase: ReturnType<typeof createBrowserSupabaseClient>;
    try {
      supabase = createBrowserSupabaseClient();
    } catch {
      return;
    }

    const channel = supabase.channel(`realtime:workspace:${userId}`);

    channel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newRow = payload.new as {
            id: string;
            title: string;
            body: string;
            category?: string | null;
            action_url?: string | null;
            created_at: string;
            read_at?: string | null;
          };

          if (!newRow.read_at) {
            setUnreadCount((prev) => prev + 1);
          }

          addToast({
            id: newRow.id,
            title: newRow.title,
            body: newRow.body,
            category: newRow.category,
            actionUrl: newRow.action_url,
            createdAt: newRow.created_at,
          });

          // Soft-refresh the server components to reflect live changes
          router.refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const updatedRow = payload.new as { id: string; read_at?: string | null };
          if (updatedRow.read_at) {
            setUnreadCount((prev) => Math.max(0, prev - 1));
          }
          router.refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "jobs",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          router.refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "applications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          router.refresh();
        },
      )
      .subscribe((status) => {
        setIsRealtimeConnected(status === "SUBSCRIBED");
      });

    // Refresh when user returns to the tab to ensure fresh state without periodic lag
    const onFocus = () => {
      router.refresh();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [userId, addToast, router]);

  const value = useMemo(
    () => ({
      unreadCount,
      toasts,
      dismissToast,
      markNotificationRead,
      isRealtimeConnected,
    }),
    [unreadCount, toasts, dismissToast, markNotificationRead, isRealtimeConnected],
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
      <RealtimeToastContainer
        toasts={toasts}
        onDismiss={dismissToast}
        onMarkRead={markNotificationRead}
      />
    </RealtimeContext.Provider>
  );
}
