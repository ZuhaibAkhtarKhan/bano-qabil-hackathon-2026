import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { onboardingHref } from "@1apply/contracts";

import { AppSidebar } from "@/components/app/sidebar";
import { MobileTopbar } from "@/components/app/mobile-topbar";
import { NeedsYouBadgeProvider } from "@/components/app/needs-you-badge-provider";
import { RealtimeWorkspaceProvider } from "@/components/app/realtime-provider";
import { WorkspaceTour } from "@/components/app/workspace-tour";
import { getCurrentUserAndProfile, onboardingComplete } from "@/lib/profile";
import { loadWorkspaceGuide } from "@/server/workspace/queries";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { user, profile } = await getCurrentUserAndProfile();
  if (!user || !profile) {
    redirect("/sign-in?next=/app");
  }

  if (!onboardingComplete(profile)) {
    redirect(onboardingHref(profile.onboarding_step));
  }

  const guide = await loadWorkspaceGuide();

  return (
    <RealtimeWorkspaceProvider userId={user.id} initialUnreadCount={0}>
      <NeedsYouBadgeProvider userId={user.id}>
        <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-white"
          >
            Skip to content
          </a>
          <div className="hidden lg:block">
            <div className="sticky top-0 h-screen">
              <AppSidebar email={profile.email} displayName={profile.display_name} />
            </div>
          </div>
          <div className="min-w-0">
            <MobileTopbar email={profile.email} />
            <WorkspaceTour dismissed={guide.dismissed} steps={guide.steps} />
            {children}
          </div>
        </div>
      </NeedsYouBadgeProvider>
    </RealtimeWorkspaceProvider>
  );
}
