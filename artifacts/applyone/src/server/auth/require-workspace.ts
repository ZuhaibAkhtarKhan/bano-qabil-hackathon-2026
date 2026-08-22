import { getCurrentUserAndProfile, type ProfileRow } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { toActor, type Actor } from "@/auth/actor";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

export async function requireWorkspace(): Promise<{
  user: User;
  profile: ProfileRow;
  supabase: SupabaseClient;
  actor: Actor;
}> {
  const { user, profile } = await getCurrentUserAndProfile();
  if (!user || !profile) {
    redirect("/sign-in");
  }
  const supabase = await createServerSupabaseClient();
  return { user, profile, supabase, actor: toActor(user, profile) };
}
