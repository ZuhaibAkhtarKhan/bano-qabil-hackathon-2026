"use client";

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

import { useActionProgress, useReportActionPending } from "@/components/ui/action-progress";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "inverse" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-zinc-800 border border-ink",
  secondary: "bg-transparent text-ink border border-ink/15 hover:border-ink/40 hover:bg-white",
  ghost: "bg-transparent text-ink hover:bg-white/70 border border-transparent",
  inverse: "bg-white text-ink hover:bg-zinc-100 border border-white",
  danger: "bg-transparent text-coral border border-coral/30 hover:bg-coral-soft",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-xs",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-6 text-sm",
};

export function buttonClassName(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
) {
  return cn(
    "ui-button inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[background-color,color,border-color,box-shadow] duration-200 ease-out group disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button className={buttonClassName(variant, size, className)} {...props} />;
}

export function SubmitButton({
  children,
  pendingText,
  pending: pendingOverride,
  variant = "primary",
  size = "md",
  className,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  pendingText?: string;
  /** Force pending UI for client-handled forms (useFormStatus stays false after preventDefault). */
  pending?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const { pending: formPending } = useFormStatus();
  const pending = pendingOverride ?? formPending;
  useReportActionPending(pending);

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={buttonClassName(variant, size, className)}
      {...props}
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>{pendingText ?? "Working…"}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Client-side async click handler with spinner + global progress bar. */
export function AsyncButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  className,
  disabled,
  onClick,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  children: ReactNode;
  pendingText?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  useReportActionPending(pending);

  return (
    <button
      type="button"
      disabled={pending || disabled}
      aria-busy={pending}
      className={buttonClassName(variant, size, className)}
      {...props}
      onClick={async (event) => {
        if (!onClick) return;
        setPending(true);
        try {
          await onClick(event);
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>{pendingText ?? "Working…"}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  onClick,
  ...props
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { beginNavigation } = useActionProgress();

  return (
    <Link
      href={href}
      className={buttonClassName(variant, size, className)}
      onClick={(event) => {
        beginNavigation();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </Link>
  );
}
