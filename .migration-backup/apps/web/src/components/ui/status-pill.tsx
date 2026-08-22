import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { SEMANTIC_STATUS, type SemanticStatus, type StatusTone } from "@/lib/status";

const tones: Record<StatusTone, string> = {
  mint: "border-emerald-200/80 bg-mint-soft text-mint-text",
  teal: "border-cyan-200/80 bg-teal-soft text-teal-text",
  violet: "border-violet-200/80 bg-violet-soft text-violet-text",
  coral: "border-rose-200/80 bg-coral-soft text-coral-text",
  sand: "border-amber-200/80 bg-sand-soft text-sand-text",
  muted: "border-line bg-white text-ink-muted",
};

export function StatusPill({
  tone = "muted",
  dashed = false,
  children,
  className,
  title,
}: {
  tone?: StatusTone;
  dashed?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold shadow-sm",
        tones[tone],
        dashed && "border-dashed",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

export function SemanticBadge({ status, className }: { status: SemanticStatus; className?: string }) {
  const meta = SEMANTIC_STATUS[status];
  return (
    <StatusPill tone={meta.tone} dashed={meta.pattern === "dashed"} className={className} title={meta.description}>
      {meta.label}
    </StatusPill>
  );
}
