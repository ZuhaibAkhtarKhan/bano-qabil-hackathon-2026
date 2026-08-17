import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function EmptyState({
  eyebrow,
  title,
  body,
  actions,
}: {
  eyebrow: string;
  title: string;
  body: string;
  actions?: ReactNode;
}) {
  return (
    <section className="max-w-xl">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">{eyebrow}</p>
      <h2 className="mt-3 font-display text-3xl sm:text-4xl">{title}</h2>
      <p className="mt-4 text-sm leading-6 text-ink-muted">{body}</p>
      {actions ? <div className="mt-6 flex flex-wrap gap-2">{actions}</div> : null}
    </section>
  );
}

export function ErrorState({
  title = "Something went wrong",
  body = "The workspace could not load this view. Nothing was submitted.",
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
}) {
  return (
    <section className="max-w-xl rounded-2xl border border-rose-200 bg-coral-soft p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-coral-text">Error</p>
      <h2 className="mt-3 font-display text-3xl">{title}</h2>
      <p className="mt-4 text-sm leading-6 text-ink-muted">{body}</p>
      {onRetry ? (
        <Button type="button" className="mt-6" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </section>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-xl", className)} aria-hidden="true" />;
}

export function PageSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-12 w-2/3 max-w-lg" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}

export function Notice({
  tone = "mint",
  children,
}: {
  tone?: "mint" | "coral" | "sand";
  children: ReactNode;
}) {
  const styles = {
    mint: "border-emerald-200 bg-mint-soft text-mint-text",
    coral: "border-rose-200 bg-coral-soft text-coral-text",
    sand: "border-amber-200 bg-sand-soft text-sand-text",
  };
  return (
    <p role="status" className={cn("rounded-2xl border px-4 py-3 text-sm", styles[tone])}>
      {children}
    </p>
  );
}
