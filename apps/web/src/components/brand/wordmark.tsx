import { cn } from "@/lib/cn";

/**
 * Wordmark: favicon “1” in a black rounded mark + “apply” in the site sans (Geist).
 * Matches Project One–style lockup: [mark] Label
 */
export function Wordmark({ inverted = false, size = "md" }: { inverted?: boolean; size?: "sm" | "md" }) {
  const mark = size === "sm" ? "h-7 w-7 rounded-[6px]" : "h-8 w-8 rounded-[7px]";
  const label = size === "sm" ? "text-lg" : "text-2xl";

  return (
    <span
      className={cn("inline-flex items-center gap-2", inverted ? "text-white" : "text-ink")}
      aria-label="1 apply"
    >
      <span className={cn("inline-grid shrink-0 place-items-center overflow-hidden bg-ink", mark)} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- brand asset, not content image */}
        <img src="/brand-mark.jpg" alt="" width={32} height={32} className="h-full w-full object-cover" />
      </span>
      <span className={cn("font-sans font-bold tracking-tight", label)}>apply</span>
    </span>
  );
}
