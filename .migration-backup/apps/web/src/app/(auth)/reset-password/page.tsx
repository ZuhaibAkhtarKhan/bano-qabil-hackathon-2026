import { Suspense } from "react";
import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="font-display text-4xl">Choose a new password</h1>
      <p className="mt-2 text-sm text-ink-muted">After updating, you will continue into onboarding or your workspace.</p>
      <div className="mt-8">
        <Suspense>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </>
  );
}
