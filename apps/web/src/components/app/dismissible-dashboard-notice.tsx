"use client";

import { useState, useTransition, type ReactNode } from "react";
import { X } from "lucide-react";

import { dismissDashboardNoticePermanently } from "@/server/memory/actions";
import { cn } from "@/lib/cn";
import type { DashboardNoticeId } from "@/lib/workspace-preferences";

export function DismissibleDashboardNotice({
  noticeId,
  className,
  labelledBy,
  children,
  tour,
}: {
  noticeId: DashboardNoticeId;
  className?: string;
  labelledBy?: string;
  children: ReactNode;
  tour?: string;
}) {
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();

  if (hidden) return null;

  return (
    <section
      className={cn("relative", className)}
      aria-labelledby={labelledBy}
      data-tour={tour}
    >
      <button
        type="button"
        onClick={() => setHidden(true)}
        className="absolute right-3 top-3 rounded-md p-1 text-ink-muted transition hover:bg-black/5 hover:text-ink"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="pr-8">{children}</div>
      <div className="mt-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setHidden(true);
            startTransition(async () => {
              try {
                await dismissDashboardNoticePermanently(noticeId);
              } catch {
                setHidden(false);
              }
            });
          }}
          className="text-xs font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-60"
        >
          {pending ? "Saving…" : "Don’t show again"}
        </button>
      </div>
    </section>
  );
}
