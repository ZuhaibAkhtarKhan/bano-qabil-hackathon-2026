"use client";

import { type ReactNode } from "react";

import { UseInKitField } from "@/components/app/use-in-kit-field";
import { SubmitButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function UploadSubmitButton({
  children,
  variant = "secondary",
  size = "sm",
  className,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "inverse" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <SubmitButton pendingText="Uploading" variant={variant} size={size} className={className}>
      {children}
    </SubmitButton>
  );
}

export function KitDocumentUploadForm({
  action,
  children,
  className,
  defaultUseInKit = true,
  compactUseInKit = false,
  showUseInKit = true,
}: {
  action: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
  className?: string;
  defaultUseInKit?: boolean;
  compactUseInKit?: boolean;
  /** When false, render UseInKitField yourself (e.g. just above the submit button). */
  showUseInKit?: boolean;
}) {
  return (
    <form action={action} className={cn("grid gap-2", className)}>
      {children}
      {showUseInKit ? <UseInKitField defaultChecked={defaultUseInKit} compact={compactUseInKit} /> : null}
    </form>
  );
}
