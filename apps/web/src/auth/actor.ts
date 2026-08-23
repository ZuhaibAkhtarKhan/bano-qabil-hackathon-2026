import type { User } from "@supabase/supabase-js";

import type { ProfileRow } from "@/lib/profile";

export type Actor = {
  userId: string;
  email: string;
  profile: ProfileRow;
};

export function toActor(user: User, profile: ProfileRow): Actor {
  return {
    userId: user.id,
    email: user.email ?? profile.email,
    profile,
  };
}
