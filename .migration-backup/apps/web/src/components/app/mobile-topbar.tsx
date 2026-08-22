"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";

import { signOut } from "@/app/app/actions";
import { Wordmark } from "@/components/brand/wordmark";
import { WORKSPACE_NAV, isNavActive } from "@/components/app/nav";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/overlays";
import { cn } from "@/lib/cn";

export function MobileTopbar({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="border-b border-line bg-white/90 backdrop-blur-md lg:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <Link href="/app">
          <Wordmark size="sm" />
        </Link>
        <Button type="button" variant="secondary" size="sm" aria-expanded={open} aria-controls="workspace-menu" aria-label="Open workspace menu" onClick={() => setOpen(true)}>
          <Menu className="h-4 w-4" aria-hidden="true" />
          Menu
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
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-11 items-center rounded-xl px-3 text-sm",
                          active ? "bg-canvas text-ink" : "text-ink-muted",
                        )}
                        onClick={() => setOpen(false)}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <form action={signOut} className="mt-8">
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
      </Drawer>
    </div>
  );
}
