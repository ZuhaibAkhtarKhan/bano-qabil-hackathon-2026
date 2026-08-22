const categories = [
  "Jobs",
  "Internships",
  "Scholarships",
  "Hackathons",
  "Fellowships",
  "Grants",
  "Research programs",
  "Accelerators",
];

export function CategoryMarquee() {
  const items = [...categories, ...categories];
  return (
    <section className="border-y border-line py-8" aria-label="Supported opportunity types">
      <p className="mb-5 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-muted">
        One memory across opportunity types
      </p>
      <div className="overflow-hidden">
        <div className="marquee-track flex w-max gap-12 px-8 text-sm font-medium text-ink-muted">
          {items.map((item, index) => (
            <span key={`${item}-${index}`} className="whitespace-nowrap">
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
