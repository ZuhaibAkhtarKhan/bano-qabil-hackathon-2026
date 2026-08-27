import type { ReactNode } from "react";
import Link from "next/link";

import { AuthChromeHeader } from "@/components/auth/auth-chrome-header";
import { Wordmark } from "@/components/brand/wordmark";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-obsidian lg:flex lg:flex-col lg:justify-between lg:px-10 lg:py-10 xl:px-14 xl:py-12">
        <div
          className="pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full bg-mint/20 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -right-16 bottom-24 h-80 w-80 rounded-full bg-teal/15 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, #fdfff8 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
          aria-hidden="true"
        />

        <Link href="/" className="relative z-10 w-fit focus-visible:outline-offset-4">
          <Wordmark inverted />
        </Link>

        <div className="relative z-10 max-w-md">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
            Application memory
          </p>
          <h2 className="mt-4 font-display text-4xl leading-[1.1] tracking-tight text-[#fdfff8] xl:text-5xl">
            Run your apply cycle with grounded AI.
          </h2>
          <p className="mt-5 text-sm leading-6 text-white/55 xl:text-base xl:leading-7">
            Evidence once. Fit, drafts, and submissions stay tied to what you approved — never a stronger version of
            you.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/55">
            <li className="flex items-start gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-mint" aria-hidden="true" />
              Kit filled from your documents
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-celadon-300" aria-hidden="true" />
              Opportunity fit without invented claims
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-parchment-100" aria-hidden="true" />
              Tracker for every posting you prepare
            </li>
          </ul>
        </div>

        <p className="relative z-10 text-xs text-white/35">Private to your account · never mixed with another user</p>
      </aside>

      <div className="relative flex min-h-screen flex-col">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.45] lg:opacity-100"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -10%, #e6f7ed 0%, transparent 55%), radial-gradient(ellipse 60% 40% at 100% 100%, #fafbf8 0%, transparent 50%)",
          }}
        />

        <AuthChromeHeader />

        <main className="relative z-10 flex flex-1 flex-col justify-center px-5 py-10 sm:px-8 sm:py-12">
          <div className="mx-auto w-full max-w-md animate-[auth-rise_0.55s_var(--ease-nominal)_both]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
