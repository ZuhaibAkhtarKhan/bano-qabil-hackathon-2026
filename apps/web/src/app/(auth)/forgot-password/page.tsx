import { Suspense } from "react";
import type { Metadata } from "next";

import { AuthFooterLink, AuthPageFrame } from "@/components/auth/auth-page-frame";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthPageFrame
      eyebrow="Account"
      title="Reset your password"
      body="We will email a secure link. It only resets your password — it cannot submit applications."
      footer={<AuthFooterLink prompt="Remembered it?" href="/sign-in" label="Back to sign in" />}
    >
      <Suspense>
        <ForgotPasswordForm />
      </Suspense>
    </AuthPageFrame>
  );
}
