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

const LIVE_TABLES = [
  "applications",
  "jobs",
  "review_items",
  "application_answers",
  "email_events",
  "calendar_events",
  "documents",
  "document_versions",
  "document_chunks",
  "field_mappings",
  "profile_facts",
  "eligibility_results",
  "opportunities",
  "evidence_items",
  "fit_evaluations",
  "application_documents",
  "notifications",
] as const;

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
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== item.id));
    }, 7000);
  }, []);

  const softRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, 250);
  }, [router]);

  useEffect(() => {
    let supabase: ReturnType<typeof createBrowserSupabaseClient>;
    try {
      supabase = createBrowserSupabaseClient();
    } catch {
      return;
    }

    void supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null)
      .then(({ count }) => {
        if (typeof count === "number") setUnreadCount(count);
      });

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
          }

          addToast({
            id: newRow.id,
            title: newRow.title,
            body: newRow.body,
            category: newRow.category,
            actionUrl: newRow.action_url,
            createdAt: newRow.created_at,
          });

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
        (payload) => {
          const updatedRow = payload.new as { id: string; read_at?: string | null };
          if (updatedRow.read_at) {
            setUnreadCount((prev) => Math.max(0, prev - 1));
          }
          softRefresh();
        },
      );

    for (const table of LIVE_TABLES) {
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
    });

    const onFocus = () => {
      softRefresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") softRefresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    const fallbackRefresh = window.setInterval(() => {
      if (!document.hidden) softRefresh();
    }, 20_000);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(fallbackRefresh);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [userId, addToast, softRefresh]);

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
