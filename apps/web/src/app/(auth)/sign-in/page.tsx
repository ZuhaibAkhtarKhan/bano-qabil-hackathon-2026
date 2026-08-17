import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <>
      <h1 className="font-display text-4xl">Welcome back</h1>
      <p className="mt-2 text-sm text-ink-muted">Your application memory stays on your account — never mixed with another user.</p>
      <div className="mt-8">
        <Suspense>
          <AuthForm mode="sign-in" />
        </Suspense>
      </div>
      <p className="mt-6 text-sm text-ink-muted">
        New here?{" "}
        <Link href="/sign-up" className="text-ink underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
