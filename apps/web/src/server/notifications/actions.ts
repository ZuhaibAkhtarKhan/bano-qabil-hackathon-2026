"use server";

import { revalidatePath } from "next/cache";

import { requireWorkspace } from "@/server/auth/require-workspace";
import { runUserAutomationSweep } from "@/server/automation/sweep";
import { markAllNotificationsRead, markNotificationRead } from "@/server/notifications/service";
import { redirectWith } from "@/server/http/flash";
import { recordAuditEvent } from "@/server/audit";

export async function markNotificationReadAction(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const id = String(formData.get("notificationId") ?? "");
  if (id) await markNotificationRead(supabase, user.id, id);
  revalidatePath("/app");
  revalidatePath("/app/notifications");
}

export async function markAllNotificationsReadAction() {
  const { user, supabase } = await requireWorkspace();
  await markAllNotificationsRead(supabase, user.id);
  revalidatePath("/app");
  revalidatePath("/app/notifications");
}

export async function runAutomationChecksAction() {
  const { actor, supabase } = await requireWorkspace();
  await runUserAutomationSweep(supabase, actor);
  await recordAuditEvent(supabase, "automation.sweep", {});
  revalidatePath("/app");
  revalidatePath("/app/notifications");
  revalidatePath("/app/applications");
  redirectWith("/app/notifications", { notice: "checks_ran" });
}