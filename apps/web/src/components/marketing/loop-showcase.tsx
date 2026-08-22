const steps = [
  "Create",
  "Analyze",
  "Match",
  "Generate",
  "Review",
  "Autofill",
  "Apply",
  "Track",
  "Remember",
];

export function LoopShowcase() {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="grid lg:grid-cols-2">
          <div className="border-b border-line p-8 lg:border-b-0 lg:border-r lg:p-12">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-muted">
              Core loop
            </p>
            <p className="mt-4 font-mono text-6xl font-medium tracking-tight">0 invented claims</p>
            <p className="mt-3 max-w-sm text-sm leading-6 text-ink-muted">
              If evidence does not exist, 1-Apply asks you or marks the field unknown. Fluency never outruns
              the record.
            </p>
          </div>
          <div className="p-8 lg:p-12">
            <blockquote className="font-display text-3xl leading-snug text-ink">
              “No evidence → no claim. Missing information becomes a question, not a better story.”
            </blockquote>
            <p className="mt-6 text-sm text-ink-muted">Responsible AI rule · 1-Apply proposal</p>
            <ol className="mt-8 flex flex-wrap gap-2">
              {steps.map((step) => (
                <li
                  key={step}
                  className="rounded-full border border-line px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-ink-muted"
                >
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
