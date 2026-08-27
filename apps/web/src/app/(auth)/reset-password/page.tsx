import { Suspense } from "react";
import type { Metadata } from "next";

import { AuthFooterLink, AuthPageFrame } from "@/components/auth/auth-page-frame";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <AuthPageFrame
      eyebrow="Account"
      title="Choose a new password"
      body="After updating, you will continue into onboarding or your workspace."
      footer={<AuthFooterLink prompt="Need to start over?" href="/sign-in" label="Back to sign in" />}
    >
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </AuthPageFrame>
  );
}
