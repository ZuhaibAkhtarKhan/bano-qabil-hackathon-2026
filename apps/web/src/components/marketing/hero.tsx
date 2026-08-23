import { ApplicationQueue } from "@/components/marketing/application-queue";
import { ButtonLink } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="relative overflow-hidden px-5 pb-8 pt-20 sm:px-8 sm:pt-28">
      <div className="relative mx-auto max-w-2xl text-center lg:max-w-3xl">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-muted">
          Application memory
        </p>
        <h1 className="mt-4 font-display text-5xl leading-[1.08] tracking-tight text-ink sm:text-6xl lg:text-7xl">
          Run your entire apply cycle with grounded AI.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-ink-muted sm:text-lg">
          Create your evidence once. 1-Apply analyzes opportunities, measures fit, drafts only from what you
          approved, and tracks every submission — without inventing a stronger version of you.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <ButtonLink href="/sign-up" size="lg">
            Create your memory
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </ButtonLink>
          <ButtonLink href="#how-it-works" variant="secondary" size="lg">
            See how it works
          </ButtonLink>
        </div>
      </div>

      <ApplicationQueue />
    </section>
  );
}
