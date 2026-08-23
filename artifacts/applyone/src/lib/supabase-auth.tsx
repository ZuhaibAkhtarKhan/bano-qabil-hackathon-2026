import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

type AuthContext = {
  session: Session | null;
  user: User | null;
  loading: boolean;
};

const AuthStateContext = createContext<AuthContext>({ session: null, user: null, loading: true });

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setLoading(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return <AuthStateContext.Provider value={{ session, user: session?.user ?? null, loading }}>{children}</AuthStateContext.Provider>;
}

export function useSupabaseAuth() {
  return useContext(AuthStateContext);
}