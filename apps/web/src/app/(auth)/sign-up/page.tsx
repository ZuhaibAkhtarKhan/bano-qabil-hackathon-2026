import { Suspense } from "react";
import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { AuthFooterLink, AuthPageFrame } from "@/components/auth/auth-page-frame";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <AuthPageFrame
      eyebrow="Get started"
      title="Create your memory"
      body="Confirm how 1-Apply may use your documents, then add name, university, education, resume, and CNIC. Skip a file only if you do not have it yet — we remind you next sign-in."
      footer={<AuthFooterLink prompt="Already have an account?" href="/sign-in" label="Sign in" />}
    >
      <Suspense>
        <AuthForm mode="sign-up" />
      </Suspense>
    </AuthPageFrame>
  );
}
