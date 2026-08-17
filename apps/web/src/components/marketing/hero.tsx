import { ButtonLink } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";

const badges = [
  { label: "Review answers", tone: "violet", className: "left-[8%] top-[18%]", delay: "float-badge" },
  { label: "Fit Index 87", tone: "mint", className: "right-[10%] top-[16%]", delay: "float-badge float-badge-delay-2" },
  { label: "Match resume", tone: "teal", className: "left-[6%] bottom-[28%]", delay: "float-badge float-badge-delay-3" },
  { label: "Track deadline", tone: "sand", className: "right-[8%] bottom-[30%]", delay: "float-badge float-badge-delay-4" },
  { label: "Evidence only", tone: "coral", className: "left-1/2 top-[8%] -translate-x-1/2", delay: "float-badge float-badge-delay-1" },
] as const;

export function Hero() {
  return (
    <section className="relative overflow-hidden px-5 pb-8 pt-16 sm:px-8 sm:pt-24">
      <div className="pointer-events-none absolute inset-0 hidden lg:block">
        {badges.map((badge) => (
          <div key={badge.label} className={`absolute ${badge.className}`}>
            <div className={badge.delay}>
              <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
            </div>
          </div>
        ))}
      </div>

      <div className="relative mx-auto max-w-3xl text-center">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-muted">
          Application memory
        </p>
        <h1 className="mt-4 font-display text-5xl leading-[1.05] tracking-tight text-ink sm:text-6xl lg:text-7xl">
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

      <div className="relative mx-auto mt-16 max-w-4xl overflow-hidden rounded-2xl border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <p className="text-sm font-medium">Application queue</p>
          <StatusPill tone="mint">Live tracking</StatusPill>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-ink-muted">
            <tr className="border-b border-line">
              <th className="px-5 py-3 font-medium">Opportunity</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="hidden px-5 py-3 font-medium sm:table-cell">Deadline</th>
              <th className="hidden px-5 py-3 font-medium md:table-cell">Next action</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line">
              <td className="px-5 py-4">ML internship · remote</td>
              <td className="px-5 py-4">
                <StatusPill tone="sand">Review required</StatusPill>
              </td>
              <td className="hidden px-5 py-4 sm:table-cell">Tomorrow 23:59</td>
              <td className="hidden px-5 py-4 md:table-cell">Approve 1 answer</td>
            </tr>
            <tr className="border-b border-line">
              <td className="px-5 py-4">Research fellowship</td>
              <td className="px-5 py-4">
                <StatusPill tone="teal">Ready to apply</StatusPill>
              </td>
              <td className="hidden px-5 py-4 sm:table-cell">12 Sep</td>
              <td className="hidden px-5 py-4 md:table-cell">Autofill preview</td>
            </tr>
            <tr>
              <td className="px-5 py-4">Scholarship · STEM</td>
              <td className="px-5 py-4">
                <StatusPill tone="mint">Submitted</StatusPill>
              </td>
              <td className="hidden px-5 py-4 sm:table-cell">Snapshot stored</td>
              <td className="hidden px-5 py-4 md:table-cell">Track email</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
