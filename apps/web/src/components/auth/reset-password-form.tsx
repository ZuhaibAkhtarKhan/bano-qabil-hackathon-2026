"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { SubmitButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { mapAuthError } from "@/lib/auth-errors";
import { isSupabaseConfigured } from "@/lib/env";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!isSupabaseConfigured()) {
      setError("Supabase is not configured on this environment.");
      return;
    }
    setPending(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      router.push("/app/onboarding/consent");
      router.refresh();
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
      <Field label="New password" htmlFor="new-password">
        <Input
          id="new-password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          placeholder="••••••••"
        />
      </Field>
      <Field label="Confirm password" htmlFor="confirm-password">
        <Input
          id="confirm-password"
          type="password"
          required
          minLength={8}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="new-password"
          placeholder="••••••••"
        />
      </Field>
      {error ? (
        <p className="rounded-xl border border-rose-200 bg-coral-soft px-3 py-2.5 text-sm text-coral-text" role="alert">
          {error}
        </p>
      ) : null}
      <SubmitButton className="w-full" disabled={pending} pending={pending} pendingText="Updating password…">
        Update password
        <span aria-hidden="true">→</span>
      </SubmitButton>
    </form>
  );
}
