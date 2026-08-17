const pillars = [
  {
    title: "Application Memory",
    summary: "Resumes, projects, and prior answers become verified evidence — not a chat transcript.",
    points: ["Extract once, confirm yourself", "Versioned documents", "Nothing invented"],
    tone: "bg-mint-soft text-emerald-800",
  },
  {
    title: "Fit before effort",
    summary: "Every opportunity is compared to your memory with a Fit Index you can inspect.",
    points: ["Eligibility, not vibes", "Resume matching", "Missing facts become questions"],
    tone: "bg-teal-soft text-cyan-800",
  },
  {
    title: "Apply with control",
    summary: "Grounded drafts, explicit approval, then autofill. Submission stays in your hands.",
    points: ["Evidence-cited answers", "Preview before fill", "CAPTCHA and paywalls untouched"],
    tone: "bg-violet-soft text-violet-800",
  },
];

export function Pillars() {
  return (
    <section id="platform" className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-muted">
        Platform
      </p>
      <h2 className="mt-3 max-w-3xl font-display text-4xl leading-tight sm:text-5xl">
        Create once. Analyze, match, generate, review, apply, remember.
      </h2>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {pillars.map((pillar) => (
          <article key={pillar.title} className="rounded-2xl border border-line bg-white p-6">
            <span className={`inline-flex h-10 w-10 items-center rounded-full ${pillar.tone}`} aria-hidden="true" />
            <h3 className="mt-5 text-lg font-semibold">{pillar.title}</h3>
            <p className="mt-2 text-sm leading-6 text-ink-muted">{pillar.summary}</p>
            <ul className="mt-5 space-y-2 text-sm">
              {pillar.points.map((point) => (
                <li key={point} className="text-ink">
                  ▸ {point}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
