"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";

import { signOut } from "@/app/app/actions";
import { Wordmark } from "@/components/brand/wordmark";
import { WORKSPACE_NAV, isNavActive } from "@/components/app/nav";
import { Button, SubmitButton } from "@/components/ui/button";
import { Drawer } from "@/components/ui/overlays";
import { cn } from "@/lib/cn";

import { useRealtime } from "@/components/app/realtime-provider";

export function MobileTopbar({
  email,
  needsYouApplicationCount = 0,
}: {
  email: string;
  needsYouApplicationCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { unreadCount } = useRealtime();

  return (
    <div className="border-b border-line bg-white/90 backdrop-blur-md lg:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <Link href="/app">
          <Wordmark size="sm" />
        </Link>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-tour="nav-menu"
          aria-expanded={open}
          aria-controls="workspace-menu"
          aria-label="Open workspace menu"
          onClick={() => setOpen(true)}
          className="relative"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
          Menu
          {(unreadCount > 0 || needsYouApplicationCount > 0) && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-sand px-1 font-mono text-[9px] font-bold text-ink-base">
              {unreadCount > 0 ? (unreadCount > 9 ? "9+" : unreadCount) : needsYouApplicationCount > 9 ? "9+" : needsYouApplicationCount}
            </span>
          )}
        </Button>
      </div>
      <Drawer id="workspace-menu" title="Workspace" open={open} onClose={() => setOpen(false)}>
        <p className="text-xs text-ink-muted">{email}</p>
        <nav className="mt-6 grid gap-6" aria-label="Mobile workspace">
          {WORKSPACE_NAV.map((section) => (
            <div key={section.id}>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">{section.label}</p>
              <ul className="mt-2 grid gap-1">
                {section.items.map((item) => {
                  const active = isNavActive(pathname, item.href);
                  const isNotifications = item.href === "/app/notifications";
                  const isNeedsYou = item.href === "/app/needs-you";
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        data-tour={item.tourId}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-11 items-center justify-between rounded-xl px-3 text-sm",
                          active ? "bg-canvas text-ink" : "text-ink-muted",
                        )}
                        onClick={() => setOpen(false)}
                      >
                        <span>{item.label}</span>
                        {isNeedsYou ? (
                          <span
                            className={cn(
                              "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-mono text-[10px] font-bold",
                              needsYouApplicationCount > 0
                                ? "bg-coral-soft text-coral-text"
                                : "bg-canvas text-ink-muted",
                            )}
                            aria-label={`${needsYouApplicationCount} applications need input`}
                          >
                            {needsYouApplicationCount > 99 ? "99+" : needsYouApplicationCount}
                          </span>
                        ) : null}
                        {isNotifications && unreadCount > 0 && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sand px-1.5 font-mono text-[10px] font-bold text-ink-base">
                            {unreadCount}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <form action={signOut} className="mt-8">
          <SubmitButton variant="secondary">
            Sign out
          </SubmitButton>
        </form>
      </Drawer>
    </div>
  );
}
