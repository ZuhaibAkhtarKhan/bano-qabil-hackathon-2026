"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { signOut } from "@/app/app/actions";
import { Wordmark } from "@/components/brand/wordmark";
import { WORKSPACE_NAV, isNavActive } from "@/components/app/nav";
import { SubmitButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { useRealtime } from "@/components/app/realtime-provider";

export function AppSidebar({ email, displayName }: { email: string; displayName: string | null }) {
  const pathname = usePathname();
  const { unreadCount } = useRealtime();

  return (
    <aside className="flex h-full flex-col border-r border-line bg-white px-4 py-6">
      <Link href="/app" className="px-2">
        <Wordmark />
      </Link>
      <p className="mt-3 px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
        Application OS
      </p>
      <nav className="mt-8 grid gap-6" aria-label="Workspace">
        {WORKSPACE_NAV.map((section) => (
          <div key={section.id}>
            <p className="px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">{section.label}</p>
            <ul className="mt-2 grid gap-1">
              {section.items.map(({ href, label, icon: Icon }) => {
                const active = isNavActive(pathname, href);
                const isNotifications = href === "/app/notifications";
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 text-sm",
                        active ? "bg-canvas text-ink" : "text-ink-muted hover:bg-canvas hover:text-ink",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        {label}
                      </div>
                      {isNotifications && unreadCount > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sand px-1.5 font-mono text-[10px] font-bold text-ink-base transition-all animate-in zoom-in-50">
                          {unreadCount > 99 ? "99+" : unreadCount}
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
      <div className="mt-auto border-t border-line px-2 pt-4">
        <p className="truncate text-sm font-medium">{displayName ?? "Applicant"}</p>
        <p className="truncate text-xs text-ink-muted">{email}</p>
        <form action={signOut}>
          <SubmitButton variant="ghost" size="sm" className="mt-3 px-0 text-ink-muted hover:text-ink" pendingText="Signing out…">
            Sign out
          </SubmitButton>
        </form>
      </div>
    </aside>
  );
}
