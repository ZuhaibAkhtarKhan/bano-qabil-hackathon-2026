import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { onboardingHref } from "@1apply/contracts";

import { AppSidebar } from "@/components/app/sidebar";
import { MobileTopbar } from "@/components/app/mobile-topbar";
import { RealtimeWorkspaceProvider } from "@/components/app/realtime-provider";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { loadOnboardingState, onboardingComplete } from "@/lib/profile";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const state = await loadOnboardingState();
  if (!state) {
    redirect("/sign-in?next=/app");
  }

  if (!onboardingComplete(state.profile)) {
    redirect(onboardingHref(state.step));
  }

  const supabase = await createServerSupabaseClient();
  const { count: unreadCount } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", state.user.id)
    .is("read_at", null);

  return (
    <RealtimeWorkspaceProvider userId={state.user.id} initialUnreadCount={unreadCount ?? 0}>
      <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          Skip to content
        </a>
        <div className="hidden lg:block">
          <div className="sticky top-0 h-screen">
            <AppSidebar email={state.profile.email} displayName={state.profile.display_name} />
          </div>
        </div>
        <div className="min-w-0">
          <MobileTopbar email={state.profile.email} />
          {children}
        </div>
      </div>
    </RealtimeWorkspaceProvider>
  );
}
