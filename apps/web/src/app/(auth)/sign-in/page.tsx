import { Suspense } from "react";
import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthFooterLink, AuthPageFrame } from "@/components/auth/auth-page-frame";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <AuthPageFrame
      eyebrow="Welcome back"
      title="Sign in to your kit"
      body="Your application memory stays on your account — never mixed with another user."
      footer={<AuthFooterLink prompt="New here?" href="/sign-up" label="Create an account" />}
    >
      <Suspense>
        <AuthForm mode="sign-in" />
      </Suspense>
    </AuthPageFrame>
  );
}
