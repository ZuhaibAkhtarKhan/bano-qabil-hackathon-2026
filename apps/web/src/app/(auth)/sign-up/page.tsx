import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="font-display text-4xl">Create your memory</h1>
      <p className="mt-2 text-sm text-ink-muted">
        You will confirm how 1-Apply may use your documents, then fill name, university, education, resume, CNIC, and B-form. Skip a file only if you do not have it yet — we remind you the next time you sign in.
      </p>
      <div className="mt-8">
        <Suspense>
          <AuthForm mode="sign-up" />
        </Suspense>
      </div>
      <p className="mt-6 text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-ink underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
