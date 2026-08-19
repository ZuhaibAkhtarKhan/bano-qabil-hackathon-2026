"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireWorkspace } from "@/server/auth/require-workspace";
import { recordAuditEvent } from "@/server/audit";
import { redirectWith } from "@/server/http/flash";

export async function requestAccountDeletion(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const confirm = String(formData.get("confirm") ?? "");
  if (confirm !== user.email) {
    redirectWith("/app/settings", { error: "required" });
  }

  await recordAuditEvent(supabase, "account.deletion_requested", { email: user.email });

  const { error } = await supabase.from("profiles").delete().eq("id", user.id);
  if (error) {
    redirectWith("/app/settings", { error: "save" });
  }

  await supabase.auth.signOut();
  revalidatePath("/");
  redirect("/sign-in?notice=deleted");
}
