import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, CheckCircle2, Mail, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";
import { supabase } from "@/lib/supabase";

type AuthMode = "sign-in" | "sign-up" | "forgot-password" | "reset-password";
const copy: Record<AuthMode, { eyebrow: string; title: string; body: string }> = {
  "sign-in": { eyebrow: "Welcome back", title: "Continue your application work.", body: "Your application memory stays on your account — never mixed with another user." },
  "sign-up": { eyebrow: "Create account", title: "Start with what is true about you.", body: "Build a private, reusable application memory once and bring it to every opportunity." },
  "forgot-password": { eyebrow: "Password help", title: "Get back into your workspace.", body: "We’ll send a reset link to the address you use for 1-Apply." },
  "reset-password": { eyebrow: "Set a password", title: "Choose a new password.", body: "Use a long, unique password to keep your application materials private." },
};

export function AuthScreen({ mode }: { mode: AuthMode }) {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const content = copy[mode];

  useEffect(() => {
    if (mode !== "reset-password") return;
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMessage("Choose a new password below.");
    });
    return () => listener.subscription.unsubscribe();
  }, [mode]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null); setMessage(null); setPending(true);
    try {
      if (mode === "sign-in") {
        const result = await supabase.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        setLocation("/app");
      } else if (mode === "sign-up") {
        const result = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName || undefined }, emailRedirectTo: `${window.location.origin}/auth/callback?next=/app/onboarding/consent` },
        });
        if (result.error) throw result.error;
        setMessage(result.data.session ? "Account created. Opening your workspace." : "Check your email to confirm the account, then sign in.");
        if (result.data.session) setLocation("/app/onboarding/consent");
      } else if (mode === "forgot-password") {
        const result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/reset-password` });
        if (result.error) throw result.error;
        setMessage("If an account exists for that email, a reset link is on its way.");
      } else {
        const result = await supabase.auth.updateUser({ password });
        if (result.error) throw result.error;
        setMessage("Password updated. You can return to sign in.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The account action could not be completed.");
    } finally { setPending(false); }
  }

  return <main className="min-h-screen bg-canvas px-5 py-6 sm:px-8"><div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl flex-col"><Link href="/" className="inline-flex w-fit"><Wordmark /></Link><section className="my-auto grid overflow-hidden rounded-[2rem] border border-line bg-white shadow-[0_24px_80px_rgba(14,14,14,0.08)] lg:grid-cols-[1.15fr_0.85fr]"><div className="bg-obsidian p-8 text-white sm:p-12"><p className="font-mono text-[11px] uppercase tracking-[0.2em] text-mint-300">{content.eyebrow}</p><h1 className="mt-5 max-w-md font-display text-5xl leading-[0.95] sm:text-6xl">{content.title}</h1><p className="mt-7 max-w-md text-sm leading-6 text-zinc-300">{content.body}</p><div className="mt-12 grid gap-4 text-sm text-zinc-300">{["Evidence stays reviewable", "No auto-submit, ever", "One memory for every application"].map((item) => <p key={item} className="flex items-center gap-3"><ShieldCheck className="h-4 w-4 text-mint" />{item}</p>)}</div></div><div className="p-8 sm:p-12"><form onSubmit={submit} className="space-y-5">{mode === "sign-up" && <div><label htmlFor="name" className="text-sm font-medium">Display name</label><input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" className="mt-2 h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm" /></div>}<div><label htmlFor="email" className="text-sm font-medium">Email</label><input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="mt-2 h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm" /></div>{mode !== "forgot-password" && <div><label htmlFor="password" className="text-sm font-medium">{mode === "reset-password" ? "New password" : "Password"}</label><input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "reset-password" || mode === "sign-up" ? "new-password" : "current-password"} className="mt-2 h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm" /></div>}{mode === "sign-in" && <Link href="/forgot-password" className="block text-sm underline">Forgot password?</Link>}{error && <p className="text-sm text-rose-700" role="alert">{error}</p>}{message && <p className="text-sm text-emerald-800" role="status">{message}</p>}<Button type="submit" className="w-full" disabled={pending}>{pending ? "Working…" : mode === "sign-up" ? "Create account" : mode === "forgot-password" ? "Send reset link" : mode === "reset-password" ? "Update password" : "Sign in"}</Button>{mode === "sign-in" && <Button type="button" variant="secondary" className="w-full" disabled={pending} onClick={async () => { if (!email) { setError("Enter your email address first."); return; } setPending(true); const result = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/app` } }); setPending(false); if (result.error) setError(result.error.message); else setMessage("Magic link sent. Check your inbox."); }}>Email a magic link</Button>}<Link href="/" className="flex items-center justify-center gap-2 text-sm text-ink-muted"><ArrowLeft className="h-4 w-4" />Back to site</Link></form></div></section></div></main>;
}