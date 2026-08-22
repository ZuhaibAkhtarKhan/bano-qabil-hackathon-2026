import type { User } from "@supabase/supabase-js";

import { getCurrentUserAndProfile, type ProfileRow } from "@/lib/profile";
import { redirect } from "next/navigation";

export type Actor = {
  userId: string;
  email: string;
  profile: ProfileRow;
};

export async function requireActor(): Promise<Actor> {
  const { user, profile } = await getCurrentUserAndProfile();
  if (!user || !profile) {
    redirect("/sign-in");
  }
  return toActor(user, profile);
}

export function toActor(user: User, profile: ProfileRow): Actor {
  return {
    userId: user.id,
    email: user.email ?? profile.email,
    profile,
  };
}

export function ownedUserId(actor: Actor): string {
  return actor.userId;
}
