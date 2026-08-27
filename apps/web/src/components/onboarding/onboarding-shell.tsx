import { ONBOARDING_STEPS, type OnboardingStep } from "@1apply/contracts";

import type { ReactNode } from "react";

import { signOut } from "@/app/app/actions";
import { Wordmark } from "@/components/brand/wordmark";
import { SubmitButton } from "@/components/ui/button";
import { Progress } from "@/components/ui/data";
import { cn } from "@/lib/cn";

export function OnboardingProgress({ current }: { current: OnboardingStep }) {
  const index = ONBOARDING_STEPS.findIndex((step) => step.id === current);
  const percent = Math.round(((Math.max(index, 0) + 1) / ONBOARDING_STEPS.length) * 100);

  return (
    <div className="mb-8">
      <Progress value={percent} label="Onboarding progress" />
      <ol className="mt-4 flex flex-wrap gap-2" aria-label="Onboarding steps">
        {ONBOARDING_STEPS.map((step, stepIndex) => {
          const active = step.id === current;
          const complete = stepIndex < index;
          return (
            <li key={step.id}>
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold",
                  active
                    ? "border-ink bg-ink text-white"
                    : complete
                      ? "border-emerald-200 bg-mint-soft text-mint-text"
                      : "border-line bg-white text-ink-muted",
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function OnboardingShell({
  eyebrow,
  title,
  body,
  step,
  children,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  step: OnboardingStep;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-5 py-10 sm:px-8">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Wordmark size="sm" />
        <form action={signOut}>
          <SubmitButton variant="ghost" size="sm" className="px-0 text-ink-muted hover:text-ink" pendingText="Signing out…">
            Sign out
          </SubmitButton>
        </form>
      </div>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">{eyebrow}</p>
      <h1 className="mt-3 font-display text-4xl leading-tight">{title}</h1>
      {body ? <p className="mt-4 text-sm leading-6 text-ink-muted">{body}</p> : null}
      <OnboardingProgress current={step} />
      {children}
    </main>
  );
}
