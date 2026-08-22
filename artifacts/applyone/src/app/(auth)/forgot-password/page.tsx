import { Suspense } from "react";
import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="font-display text-4xl">Reset your password</h1>
      <p className="mt-2 text-sm text-ink-muted">We will email a secure link. It only resets your password — it cannot submit applications.</p>
      <div className="mt-8">
        <Suspense>
          <ForgotPasswordForm />
        </Suspense>
      </div>
    </>
  );
}
