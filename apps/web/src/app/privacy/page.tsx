import Link from "next/link";
import type { Metadata } from "next";

import { Wordmark } from "@/components/brand/wordmark";
import { PrivacyPolicyContent } from "@/components/legal/privacy-policy-content";
import { SiteFooter } from "@/components/marketing/site-footer";
import { loadAppConfig } from "@/config/env";

export const metadata: Metadata = {
  title: "Privacy Policy — 1-Apply",
  description:
    "How 1-Apply collects, uses, and protects your application data, documents, and Chrome extension usage.",
};

export default function PrivacyPage() {
  const { appUrl } = loadAppConfig();

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href="/" className="shrink-0 focus-visible:outline-offset-4">
            <Wordmark />
          </Link>
          <Link href="/sign-in" className="text-sm font-medium text-ink-muted hover:text-ink">
            Sign in
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <header className="mb-10 border-b border-line pb-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">Legal</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-ink-muted">
            Effective date: September 1, 2026 · Last updated: September 1, 2026
          </p>
        </header>

        <PrivacyPolicyContent appUrl={appUrl} />
      </main>

      <SiteFooter />
    </div>
  );
}
