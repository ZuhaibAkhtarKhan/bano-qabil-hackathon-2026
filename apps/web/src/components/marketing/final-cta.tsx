import { ButtonLink } from "@/components/ui/button";
import { TextRevealHeading } from "@/components/marketing/text-reveal-heading";

export function FinalCta() {
  return (
    <section className="bg-obsidian px-5 py-24 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 border-t border-white/10 pt-16 lg:flex-row lg:items-center">
        <TextRevealHeading tone="dark" className="max-w-3xl">
          Move from rebuilding yourself on every form to a memory that travels with you.
        </TextRevealHeading>
        <ButtonLink href="/sign-up" variant="inverse" size="lg">
          Create your memory
          <span aria-hidden="true">→</span>
        </ButtonLink>
      </div>
    </section>
  );
}
