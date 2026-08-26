import { currentGuideStep, type GuideStep } from "@1apply/domain";
import Link from "next/link";

import { skipWorkspaceGuide } from "@/server/memory/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function WorkspaceGuideCard({
  dismissed,
  steps,
}: {
  dismissed: boolean;
  steps: GuideStep[];
}) {
  const next = currentGuideStep(steps);
  if (dismissed || !next) return null;
  const later = steps.filter((step) => step.id !== next.id);

  return (
    <Card className="mt-8 p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Next step</p>
      <h2 className="mt-1 font-display text-2xl">{next.title}</h2>
      <p className="mt-2 text-sm text-ink-muted">{next.body}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ButtonLink href={next.href}>{next.cta}</ButtonLink>
        <form action={skipWorkspaceGuide}>
          <Button type="submit" variant="ghost">
            Skip tutorial
          </Button>
        </form>
      </div>
      {later.length > 0 ? (
        <ol className="mt-5 grid gap-2 text-sm text-ink-muted">
          {later.map((step, index) => (
            <li key={step.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                Then {index + 2}: {step.title}
                {step.optional ? " (optional)" : ""}
              </span>
              <Link className="underline" href={step.href}>
                {step.cta}
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
    </Card>
  );
}

export function WorkspaceGuideBar({
  dismissed,
  steps,
}: {
  dismissed: boolean;
  steps: GuideStep[];
}) {
  const next = currentGuideStep(steps);
  if (dismissed || !next) return null;

  return (
    <div className="border-b border-line bg-white px-4 py-3 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className="font-medium">Next:</span> {next.title}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href={next.href} size="sm">
            {next.cta}
          </ButtonLink>
          <form action={skipWorkspaceGuide}>
            <Button type="submit" variant="ghost" size="sm">
              Skip tutorial
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
