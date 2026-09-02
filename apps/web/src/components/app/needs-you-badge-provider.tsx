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

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

type NeedsYouBadgeCounts = {
  applicationCount: number;
  totalFields: number;
};

const NeedsYouBadgeContext = createContext<NeedsYouBadgeCounts>({
  applicationCount: 0,
  totalFields: 0,
});

export function useNeedsYouBadge() {
  return useContext(NeedsYouBadgeContext);
}

const BADGE_TABLES = [
  "applications",
  "application_answers",
  "field_mappings",
  "eligibility_results",
  "application_documents",
  "documents",
] as const;

export function NeedsYouBadgeProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [counts, setCounts] = useState<NeedsYouBadgeCounts>({ applicationCount: 0, totalFields: 0 });
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/needs-you/counts", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as NeedsYouBadgeCounts;
      setCounts({
        applicationCount: Math.max(0, data.applicationCount ?? 0),
        totalFields: Math.max(0, data.totalFields ?? 0),
      });
    } catch {
      // Best-effort — badge stays at last known value.
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void refresh();
    }, 600);
  }, [refresh]);

  useEffect(() => {
    void refresh();

    let supabase: ReturnType<typeof createBrowserSupabaseClient>;
    try {
      supabase = createBrowserSupabaseClient();
    } catch {
      return;
    }

    let channel = supabase.channel(`needs-you-badge:${userId}`);
    for (const table of BADGE_TABLES) {
      for (const event of ["INSERT", "UPDATE", "DELETE"] as const) {
        channel = channel.on(
          "postgres_changes",
          { event, schema: "public", table, filter: `user_id=eq.${userId}` },
          scheduleRefresh,
        );
      }
    }
    channel.subscribe();

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh, scheduleRefresh]);

  const value = useMemo(() => counts, [counts]);

  return <NeedsYouBadgeContext.Provider value={value}>{children}</NeedsYouBadgeContext.Provider>;
}
