"use client";

import Link from "next/link";
import { Bell, CheckCircle2, AlertCircle, Calendar, X, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

export type RealtimeToastItem = {
  id: string;
  title: string;
  body: string;
  category?: string | null;
  actionUrl?: string | null;
  createdAt: string;
};

export function RealtimeToastContainer({
  toasts,
  onDismiss,
  onMarkRead,
}: {
  toasts: RealtimeToastItem[];
  onDismiss: (id: string) => void;
  onMarkRead?: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <aside
      aria-label="Live notifications"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2.5 sm:max-w-md"
    >
      {toasts.map((toast) => {
        const isInterview = toast.category?.includes("interview");
        const isAnswer = toast.category?.includes("answer");
        const isSubmission = toast.category?.includes("submission");
        const isDeadline = toast.category?.includes("deadline");

        return (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "relative flex flex-col gap-2 rounded-2xl border border-line bg-white/95 p-4 shadow-xl backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-5",
              isInterview
                ? "border-emerald-300 bg-emerald-50/90 text-emerald-950"
                : isDeadline
                  ? "border-amber-300 bg-amber-50/90 text-amber-950"
                  : isSubmission
                    ? "border-teal-300 bg-teal-50/90 text-teal-950"
                    : "border-line bg-white text-ink",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    isInterview
                      ? "bg-emerald-200 text-emerald-800"
                      : isDeadline
                        ? "bg-amber-200 text-amber-800"
                        : isAnswer
                          ? "bg-violet-200 text-violet-800"
                          : isSubmission
                            ? "bg-teal-200 text-teal-800"
                            : "bg-canvas text-ink-muted",
                  )}
                >
                  {isInterview ? (
                    <Calendar className="h-3.5 w-3.5" />
                  ) : isAnswer ? (
                    <Sparkles className="h-3.5 w-3.5" />
                  ) : isSubmission ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : isDeadline ? (
                    <AlertCircle className="h-3.5 w-3.5" />
                  ) : (
                    <Bell className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                  {toast.category ? toast.category.replace(/_/g, " ") : "Live update"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="rounded-lg p-1 text-ink-muted transition hover:bg-canvas hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div>
              <p className="text-sm font-medium leading-tight">{toast.title}</p>
              <p className="mt-1 line-clamp-2 text-xs text-ink-muted leading-normal">{toast.body}</p>
            </div>

            <div className="mt-1 flex items-center justify-between gap-2 border-t border-line/50 pt-2 text-xs">
              <span className="text-[11px] text-ink-muted">Just now</span>
              <div className="flex items-center gap-3">
                {toast.actionUrl && (
                  <Link
                    href={toast.actionUrl}
                    onClick={() => {
                      onDismiss(toast.id);
                      onMarkRead?.(toast.id);
                    }}
                    className="font-medium text-teal hover:underline"
                  >
                    View
                  </Link>
                )}
                {onMarkRead && (
                  <button
                    type="button"
                    onClick={() => {
                      onMarkRead(toast.id);
                      onDismiss(toast.id);
                    }}
                    className="text-ink-muted hover:text-ink hover:underline"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </aside>
  );
}
