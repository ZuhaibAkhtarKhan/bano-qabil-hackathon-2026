import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Card({
  className,
  children,
  as: Tag = "section",
  ...props
}: HTMLAttributes<HTMLElement> & { as?: "section" | "article" | "div"; children: ReactNode }) {
  return (
    <Tag className={cn("rounded-2xl border border-line bg-white p-5 shadow-[0_1px_0_rgba(14,14,14,0.03)]", className)} {...props}>
      {children}
    </Tag>
  );
}

export function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card className="p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">{label}</p>
      <p className="mt-2 font-mono text-3xl tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </Card>
  );
}
