import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/data";
import { StatusPill } from "@/components/ui/status-pill";
import { shouldApplyCopy } from "@/lib/intelligence";
import { cn } from "@/lib/cn";

type FitRow = {
  score: number;
  skills_match: number;
  experience_match: number;
  education_match: number;
  project_relevance: number;
  eligibility: number;
  missing: string[] | null;
  strengths?: string[] | null;
  explanation?: string | null;
  should_apply?: string | null;
  factors?: Array<{ label: string; score: number; weight: number; contribution: number; why: string }> | Record<string, unknown> | null;
};

function factorList(fit: FitRow) {
  if (Array.isArray(fit.factors) && fit.factors.length > 0) {
    return fit.factors;
  }
  return [
    { label: "Eligibility", score: fit.eligibility, weight: 0.3, contribution: fit.eligibility * 0.3, why: "Share of requirements satisfied without guessing." },
    { label: "Skills Match", score: fit.skills_match, weight: 0.2, contribution: fit.skills_match * 0.2, why: "Verified skills overlap." },
    { label: "Experience Match", score: fit.experience_match, weight: 0.2, contribution: fit.experience_match * 0.2, why: "Verified employment overlap." },
    { label: "Education Match", score: fit.education_match, weight: 0.15, contribution: fit.education_match * 0.15, why: "Verified education overlap." },
    { label: "Project Relevance", score: fit.project_relevance, weight: 0.15, contribution: fit.project_relevance * 0.15, why: "Verified project overlap." },
  ];
}

export function FitIndexPanel({ fit }: { fit: FitRow | null }) {
  const apply = shouldApplyCopy(fit?.should_apply);
  const factors = fit ? factorList(fit) : [];

  return (
    <Card id="fit" className="scroll-mt-8 p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">1-Apply Fit Index</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl">Should I apply?</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ink-muted">
            Weighted from stored factors — not a single model guess. Unknown items lower the score instead of being
            treated as matches.
          </p>
        </div>
        <StatusPill tone={apply.tone}>{apply.label}</StatusPill>
      </div>

      {fit ? (
        <div className="mt-8 grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <div className={cn("rounded-[1.75rem] border border-line bg-canvas p-6 text-center")}>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">Fit Index</p>
            <p className="mt-3 font-mono text-6xl tracking-tight">
              {fit.score}
              <span className="text-2xl text-ink-muted"> / 100</span>
            </p>
            <p className="mt-4 text-xs leading-5 text-ink-muted">{fit.should_apply === "apply" ? "Strong verified overlap" : "Explainable from factors below"}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {factors.map((factor) => (
              <div key={factor.label} className="rounded-2xl border border-line p-4">
                <Progress value={factor.score} label={factor.label} />
                <p className="mt-2 font-mono text-[11px] text-ink-muted">
                  {factor.score} × {factor.weight} = {Number(factor.contribution).toFixed(1)}
                </p>
                <p className="mt-2 text-xs leading-5 text-ink-muted">{factor.why}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-6 text-sm text-ink-muted">Run analysis to compute a Fit Index from verified evidence.</p>
      )}

      {fit?.explanation ? (
        <div className="mt-8 rounded-2xl bg-ink px-5 py-4 text-white">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/60">Why is my score {fit.score}?</p>
          <p className="mt-2 font-mono text-sm leading-6">{fit.explanation}</p>
        </div>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-medium">Strengths</h3>
          <ul className="mt-3 grid gap-2">
            {(fit?.strengths ?? []).length === 0 ? (
              <li className="text-sm text-ink-muted">No verified strengths stored yet.</li>
            ) : (
              (fit?.strengths ?? []).map((item) => (
                <li key={item} className="rounded-xl bg-mint-soft px-3 py-2 text-sm text-mint-text">
                  {item}
                </li>
              ))
            )}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-medium">Missing / Unclear</h3>
          <ul className="mt-3 grid gap-2">
            {(fit?.missing ?? []).length === 0 ? (
              <li className="text-sm text-ink-muted">No missing items listed.</li>
            ) : (
              (fit?.missing ?? []).map((item) => (
                <li key={item} className="rounded-xl bg-sand-soft px-3 py-2 text-sm text-sand-text">
                  {item}
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </Card>
  );
}
