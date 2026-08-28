import type { ReactNode } from "react";
import Link from "next/link";

export function AuthPageFrame({
  eyebrow,
  title,
  body,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div>
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-muted">{eyebrow}</p>
      <h1 className="mt-3 font-display text-4xl leading-[1.1] tracking-tight text-ink sm:text-[2.75rem]">{title}</h1>
      {body ? <p className="mt-3 text-sm leading-6 text-ink-muted sm:text-[15px]">{body}</p> : null}

      <div className="mt-8 rounded-2xl border border-line bg-white/90 p-5 shadow-[0_1px_0_rgba(14,14,14,0.04)] backdrop-blur-sm sm:p-6">
        {children}
      </div>

      {footer ? <div className="mt-6 text-center text-sm text-ink-muted">{footer}</div> : null}
    </div>
  );
}

export function AuthFooterLink({
  prompt,
  href,
  label,
}: {
  prompt: string;
  href: string;
  label: string;
}) {
  return (
    <>
      {prompt}{" "}
      <Link href={href} className="font-medium text-ink underline decoration-ink/25 underline-offset-4 hover:decoration-ink">
        {label}
      </Link>
    </>
  );
}
