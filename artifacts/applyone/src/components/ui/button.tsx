import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "wouter";

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
    "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-200 group disabled:pointer-events-none disabled:opacity-50",
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

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClassName(variant, size, className)}>
      {children}
    </Link>
  );
}
