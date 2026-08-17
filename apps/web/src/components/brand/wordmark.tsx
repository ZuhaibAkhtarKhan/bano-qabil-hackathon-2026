import { cn } from "@/lib/cn";

export function Wordmark({ inverted = false, size = "md" }: { inverted?: boolean; size?: "sm" | "md" }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", inverted ? "text-white" : "text-ink")}>
      <span
        className={cn(
          "grid place-items-center rounded-[10px] border font-display leading-none",
          size === "sm" ? "h-7 w-7 text-lg" : "h-8 w-8 text-xl",
          inverted ? "border-white/20 bg-white text-ink" : "border-ink/10 bg-ink text-white",
        )}
        aria-hidden="true"
      >
        1
      </span>
      <span className={cn("font-semibold tracking-tight", size === "sm" ? "text-base" : "text-lg")}>
        1-Apply
      </span>
    </span>
  );
}
