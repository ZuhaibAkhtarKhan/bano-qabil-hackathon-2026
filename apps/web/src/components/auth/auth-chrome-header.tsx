"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Wordmark } from "@/components/brand/wordmark";
import { ButtonLink } from "@/components/ui/button";

export function AuthChromeHeader() {
  const pathname = usePathname();
  const onSignIn = pathname.startsWith("/sign-in");
  const onSignUp = pathname.startsWith("/sign-up");

  return (
    <header className="relative z-10 flex h-16 items-center justify-between border-b border-line/70 bg-canvas/90 px-5 backdrop-blur-md sm:px-8 lg:border-transparent lg:bg-transparent lg:backdrop-blur-none">
      <Link href="/" className="lg:invisible focus-visible:outline-offset-4">
        <Wordmark size="sm" />
      </Link>
      <div className="flex items-center gap-2">
        {!onSignIn ? (
          <ButtonLink href="/sign-in" variant="ghost" size="sm">
            Sign in
          </ButtonLink>
        ) : null}
        {!onSignUp ? (
          <ButtonLink href="/sign-up" size="sm">
            Get started
            <span aria-hidden="true">→</span>
          </ButtonLink>
        ) : (
          <ButtonLink href="/" variant="ghost" size="sm" className="hidden sm:inline-flex">
            Back to home
          </ButtonLink>
        )}
      </div>
    </header>
  );
}
