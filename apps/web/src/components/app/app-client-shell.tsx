"use client";

import type { ReactNode } from "react";
import { Suspense } from "react";

import { ActionProgressProvider } from "@/components/ui/action-progress";
import { EphemeralToastProvider } from "@/components/ui/ephemeral-toast";
import { NavigationProgress } from "@/components/ui/navigation-progress";

/** Client shell so form/async buttons can report pending into the global progress bar. */
export function AppClientShell({ children }: { children: ReactNode }) {
  return (
    <EphemeralToastProvider>
      <ActionProgressProvider>
        <Suspense fallback={null}>
          <NavigationProgress />
        </Suspense>
        {children}
      </ActionProgressProvider>
    </EphemeralToastProvider>
  );
}
