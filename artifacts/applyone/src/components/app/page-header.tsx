import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  body,
  actions,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-2xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">{eyebrow}</p>
        <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">{title}</h1>
        {body ? <p className="mt-4 text-sm leading-6 text-ink-muted sm:text-base">{body}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function WorkspaceMain({ children }: { children: ReactNode }) {
  return <main id="main" className="px-4 py-8 sm:px-8 lg:px-10 lg:py-10">{children}</main>;
}

export { controlClassName as inputClassName } from "@/components/ui/field";
export const labelClassName = "block text-xs font-medium text-ink-muted";
