"use client";

import type { FormEvent } from "react";
import { useState } from "react";

import { SubmitButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { mapAuthError } from "@/lib/auth-errors";
import { isSupabaseConfigured } from "@/lib/env";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!isSupabaseConfigured()) {
      setError("Supabase is not configured on this environment.");
      return;
    }
    setPending(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
      });
      if (resetError) throw resetError;
      setMessage("If an account exists for that email, a reset link is on its way.");
    } catch (caught) {
      setError(
        mapAuthError(
          caught instanceof Error ? { message: caught.message } : { message: String(caught) },
        ),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Email" htmlFor="reset-email">
        <Input
          id="reset-email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
        />
      </Field>
      {error ? (
        <p className="rounded-xl border border-rose-200 bg-coral-soft px-3 py-2.5 text-sm text-coral-text" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl border border-emerald-200 bg-mint-soft px-3 py-2.5 text-sm text-mint-text" role="status">
          {message}
        </p>
      ) : null}
      <SubmitButton className="w-full" disabled={pending} pending={pending} pendingText="Sending reset link…">
        Send reset link
        <span aria-hidden="true">→</span>
      </SubmitButton>
    </form>
  );
}
