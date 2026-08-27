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
}: {
  action: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
  className?: string;
  defaultUseInKit?: boolean;
  compactUseInKit?: boolean;
}) {
  return (
    <form action={action} className={cn("grid gap-2", className)}>
      <UseInKitField defaultChecked={defaultUseInKit} compact={compactUseInKit} />
      {children}
    </form>
  );
}
