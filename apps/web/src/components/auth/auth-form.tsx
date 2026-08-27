"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { AsyncButton, SubmitButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { authErrorFromSearchParams, ACCOUNT_EXISTS_MESSAGE, mapAuthError, safeNextPath } from "@/lib/auth-errors";
import { isSupabaseConfigured } from "@/lib/env";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(() =>
    authErrorFromSearchParams({
      reason: searchParams.get("reason"),
      error: searchParams.get("error"),
      error_code: searchParams.get("error_code"),
    }),
  );
  const [passwordPending, setPasswordPending] = useState(false);
  const configured = isSupabaseConfigured();
  const nextPath = safeNextPath(searchParams.get("next"), mode === "sign-up" ? "/app/onboarding/consent" : "/app");
  const busy = passwordPending;

  async function onPasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!configured) {
      setError("Supabase is not configured on this environment.");
      return;
    }
    setPasswordPending(true);
    try {
      const supabase = createBrowserSupabaseClient();
      if (mode === "sign-up") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName || undefined },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/app/onboarding/consent")}`,
          },
        });
        if (signUpError) throw signUpError;

        // Supabase returns a fake "success" for existing emails when confirmations
        // are on: user is present but identities is empty.
        const identities = data.user?.identities ?? [];
        if (data.user && identities.length === 0) {
          setError(ACCOUNT_EXISTS_MESSAGE);
          setPasswordPending(false);
          return;
        }

        if (data.session) {
          router.push("/app/onboarding/consent");
          router.refresh();
          return;
        }
        setMessage("Check your email to confirm the account, then sign in.");
        setPasswordPending(false);
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        router.push("/app?afterAuth=1");
        router.refresh();
        return;
      }
    } catch (caught) {
      setError(
        mapAuthError(
          caught instanceof Error
            ? { message: caught.message, code: "code" in caught ? String((caught as { code?: string }).code ?? "") : "" }
            : { message: String(caught) },
        ),
      );
      setPasswordPending(false);
    }
  }

  async function onMagicLink() {
    setError(null);
    setMessage(null);
    if (!configured) {
      setError("Supabase is not configured on this environment.");
      return;
    }
    if (!email) {
      setError("Enter an email address for the magic link.");
      return;
    }
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (otpError) throw otpError;
      setMessage("Magic link sent. It will only sign you in — it cannot submit applications.");
    } catch (caught) {
      setError(
        mapAuthError(
          caught instanceof Error ? { message: caught.message } : { message: String(caught) },
        ),
      );
    }
  }

  return (
    <form onSubmit={onPasswordSubmit} className="space-y-4">
      {mode === "sign-up" ? (
        <Field label="Display name" htmlFor="display-name">
          <Input
            id="display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="name"
          />
        </Field>
      ) : null}
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />
      </Field>
      <Field label="Password" htmlFor="password" hint={mode === "sign-up" ? "At least 8 characters." : undefined}>
        <Input
          id="password"
          type="password"
          required={mode === "sign-up"}
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
        />
      </Field>
      {mode === "sign-in" ? (
        <p className="text-sm">
          <Link href="/forgot-password" className="underline">
            Forgot password?
          </Link>
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-rose-700" role="alert">
          {error}
          {error === ACCOUNT_EXISTS_MESSAGE ? (
            <>
              {" "}
              <Link href="/sign-in" className="underline">
                Sign in
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-emerald-800" role="status">
          {message}
        </p>
      ) : null}
      <SubmitButton
        className="w-full"
        disabled={busy}
        pending={passwordPending}
        pendingText={mode === "sign-up" ? "Creating account…" : "Signing in…"}
      >
        {mode === "sign-up" ? "Create account" : "Sign in"}
      </SubmitButton>
      <AsyncButton
        variant="secondary"
        className="w-full"
        disabled={busy}
        pendingText="Sending…"
        onClick={() => onMagicLink()}
      >
        Email a magic link
      </AsyncButton>
    </form>
  );
}
