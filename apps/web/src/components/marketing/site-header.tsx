"use client";

import { Wordmark } from "@/components/brand/wordmark";
import { ButtonLink } from "@/components/ui/button";

const links = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#platform", label: "Platform" },
  { href: "#pricing", label: "Pricing" },
];

function scrollToHash(hash: string) {
  const id = hash.replace(/^#/, "");
  const el = document.getElementById(id);
  if (!el) return;

  // Instant jump so Pricing (and other anchors) don't scrub through the tall how-it-works sticky section
  el.scrollIntoView({ behavior: "auto", block: "start" });
  window.history.pushState(null, "", hash);
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-line/70 bg-canvas/90 backdrop-blur-md">
      <div className="relative flex h-16 w-full items-center pl-3 pr-5 sm:pl-4 sm:pr-8 lg:pl-6 lg:pr-10">
        <a
          href="#top"
          className="-ml-0.5 shrink-0 focus-visible:outline-offset-4 sm:-ml-1"
          onClick={(event) => {
            event.preventDefault();
            scrollToHash("#top");
          }}
        >
          <Wordmark />
        </a>

        <nav
          className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-8 text-sm text-ink-muted md:flex"
          aria-label="Primary"
        >
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="hover:text-ink"
              onClick={(event) => {
                event.preventDefault();
                scrollToHash(link.href);
              }}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <ButtonLink href="/sign-in" variant="ghost" className="hidden sm:inline-flex">
            Sign in
          </ButtonLink>
          <ButtonLink href="/sign-up">
            Get started
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}
