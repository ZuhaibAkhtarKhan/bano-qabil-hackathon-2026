import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { getCurrentUserAndProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function AppAuthLayout({ children }: { children: ReactNode }) {
  const { user } = await getCurrentUserAndProfile();
  if (!user) {
    redirect("/sign-in");
  }
  return children;
}
