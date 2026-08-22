import { ButtonLink } from "@/components/ui/button";

export function FinalCta() {
  return (
    <section className="bg-obsidian px-5 py-24 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 border-t border-white/10 pt-16 lg:flex-row lg:items-center">
        <h2 className="max-w-3xl font-display text-4xl leading-tight text-white sm:text-5xl">
          Move from rebuilding yourself on every form to a memory that travels with you.
        </h2>
        <ButtonLink href="/sign-up" variant="inverse" size="lg">
          Create your memory
          <span aria-hidden="true">→</span>
        </ButtonLink>
      </div>
    </section>
  );
}
