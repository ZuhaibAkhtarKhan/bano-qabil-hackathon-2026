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

/** Tables that should trigger a soft server refresh when visible workspace data may change. */
const REFRESH_TABLES = [
  "applications",
  "application_answers",
  "field_mappings",
  "eligibility_results",
  "application_documents",
  "review_items",
  "fit_evaluations",
  "notifications",
] as const;

const POLL_MS = 20_000;

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
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unreadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supabaseRef = useRef<ReturnType<typeof createBrowserSupabaseClient> | null>(null);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshUnreadCount = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    try {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("read_at", null);
      if (typeof count === "number") setUnreadCount(count);
    } catch {
      // Keep last known value.
    }
  }, [userId]);

  const scheduleUnreadRefresh = useCallback(() => {
    if (unreadTimer.current) clearTimeout(unreadTimer.current);
    unreadTimer.current = setTimeout(() => {
      unreadTimer.current = null;
      void refreshUnreadCount();
    }, 350);
  }, [refreshUnreadCount]);

  const markNotificationRead = useCallback(
    async (id: string) => {
      setUnreadCount((prev) => Math.max(0, prev - 1));
      try {
        const fd = new FormData();
        fd.set("notificationId", id);
        await markNotificationReadAction(fd);
      } catch {
        // Best-effort
      } finally {
        scheduleUnreadRefresh();
      }
    },
    [scheduleUnreadRefresh],
  );

  const addToast = useCallback((item: RealtimeToastItem) => {
    setToasts((prev) => [item, ...prev.slice(0, 4)]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== item.id));
    }, 7000);
  }, []);

  const softRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
      scheduleUnreadRefresh();
    }, 500);
  }, [router, scheduleUnreadRefresh]);

  useEffect(() => {
    let supabase: ReturnType<typeof createBrowserSupabaseClient>;
    try {
      supabase = createBrowserSupabaseClient();
    } catch {
      return;
    }
    supabaseRef.current = supabase;

    void refreshUnreadCount();

    let channel = supabase.channel(`realtime:workspace:${userId}`);

    channel = channel
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
            addToast({
              id: newRow.id,
              title: newRow.title,
              body: newRow.body,
              category: newRow.category,
              actionUrl: newRow.action_url,
              createdAt: newRow.created_at,
            });
          }
          scheduleUnreadRefresh();
          softRefresh();
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
        () => {
          scheduleUnreadRefresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          scheduleUnreadRefresh();
        },
      );

    for (const table of REFRESH_TABLES) {
      for (const event of ["INSERT", "UPDATE", "DELETE"] as const) {
        channel = channel.on(
          "postgres_changes",
          {
            event,
            schema: "public",
            table,
            filter: `user_id=eq.${userId}`,
          },
          () => {
            softRefresh();
          },
        );
      }
    }

    channel.subscribe((status) => {
      setIsRealtimeConnected(status === "SUBSCRIBED");
      if (status === "SUBSCRIBED") void refreshUnreadCount();
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshUnreadCount();
        softRefresh();
      }
    };
    const onFocus = () => {
      void refreshUnreadCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    // Polling fallback when Realtime is flaky or not subscribed.
    const poll = window.setInterval(() => {
      void refreshUnreadCount();
    }, POLL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(poll);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (unreadTimer.current) clearTimeout(unreadTimer.current);
      supabaseRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [userId, addToast, softRefresh, refreshUnreadCount, scheduleUnreadRefresh]);

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
