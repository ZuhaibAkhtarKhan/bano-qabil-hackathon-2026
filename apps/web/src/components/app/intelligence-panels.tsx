import { eligibilityLabel } from "@1apply/domain";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress, ScoreIndicator } from "@/components/ui/data";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { SemanticBadge, StatusPill } from "@/components/ui/status-pill";
import { addRequirement, analyzeApplication } from "@/server/applications/actions";
import { eligibilitySemanticStatus } from "@/lib/status";
import type { loadApplicationWorkspace } from "@/server/workspace/queries";

type Workspace = NonNullable<Awaited<ReturnType<typeof loadApplicationWorkspace>>>;

type FitFactorView = {
  key: string;
  label: string;
  score: number;
  weight: number;
  contribution: number;
  rationale: string;
};

function asFactors(value: unknown): FitFactorView[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is FitFactorView => {
    return Boolean(item && typeof item === "object" && "label" in item && "score" in item);
  });
}

function fitReading(score: number | null, hardMiss: boolean, missingCount: number) {
  if (hardMiss) return "Hard eligibility is not satisfied. Do not treat this as a match.";
  if (score == null) return "Run analysis to compute Fit Index from verified evidence.";
  if (missingCount > 0 && score < 70) return "Confirm missing facts before treating this as a strong match.";
  if (score >= 75) return "Strong fit from verified evidence — still not an official decision.";
  if (score >= 50) return "Moderate fit. Review gaps before you apply.";
  return "Weak fit from verified evidence. The score does not invent missing experience.";
}

function eligibilityTone(state: string): "mint" | "coral" | "sand" | "teal" | "muted" {
  if (state === "met") return "mint";
  if (state === "not_met") return "coral";
  if (state === "partial") return "teal";
  if (state === "unclear") return "sand";
  return "muted";
}

export function IntelligenceRefresh({ applicationId }: { applicationId: string }) {
  return (
    <form action={analyzeApplication}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <Button type="submit">Refresh eligibility, Fit Index, and resume match</Button>
    </form>
  );
}

export function FitIndexPanel({ data }: { data: Workspace }) {
  const fit = data.fit;
  const factors = asFactors(fit?.factors);
  const hardMiss = data.eligibility.some((item) => item.state === "not_met");
  const missing = (fit?.missing as string[] | null) ?? [];
  const strengths = (fit?.strengths as string[] | null) ?? [];
  const score = fit?.score ?? null;

  return (
    <section id="fit" className="mt-8 scroll-mt-8">
      <Card className="p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Should I apply?</p>
        <h2 className="mt-2 font-display text-2xl">Fit Index</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Weighted from five stored factors. This is not a model guessing a number out of 100.
        </p>
        {fit ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
            <div className="rounded-2xl bg-canvas p-5">
              <ScoreIndicator score={score} />
              <p className="mt-4 text-sm leading-6">{fitReading(score, hardMiss, missing.length)}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(factors.length > 0
                ? factors
                : [
                    { key: "skills", label: "Skills Match", score: fit.skills_match, weight: 0.2, contribution: 0, rationale: "" },
                    { key: "experience", label: "Experience Match", score: fit.experience_match, weight: 0.2, contribution: 0, rationale: "" },
                    { key: "education", label: "Education Match", score: fit.education_match, weight: 0.15, contribution: 0, rationale: "" },
                    { key: "projects", label: "Project Relevance", score: fit.project_relevance, weight: 0.15, contribution: 0, rationale: "" },
                    { key: "eligibility", label: "Eligibility", score: fit.eligibility, weight: 0.3, contribution: 0, rationale: "" },
                  ]
              ).map((factor) => (
                <div key={factor.key} className="rounded-2xl border border-line p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-medium">{factor.label}</p>
                    <p className="font-mono text-lg">{factor.score}</p>
                  </div>
                  <Progress value={factor.score} label={`${Math.round(factor.weight * 100)}% of Fit Index`} />
                  {factor.rationale ? <p className="mt-2 text-xs leading-5 text-ink-muted">{factor.rationale}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">Run analysis to compute a Fit Index from verified evidence.</p>
        )}
        {fit?.rationale ? (
          <div className="mt-6 rounded-2xl bg-canvas p-4 text-sm leading-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Why this score</p>
            <p className="mt-2">{fit.rationale}</p>
          </div>
        ) : null}
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">Strengths</h3>
            {strengths.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">No verified strengths stored yet.</p>
            ) : (
              <ul className="mt-2 grid gap-2 text-sm">
                {strengths.map((item) => (
                  <li key={item} className="rounded-xl border border-emerald-200/80 bg-mint-soft p-3">
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium">Missing / unclear</h3>
            {missing.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">No missing-information items stored.</p>
            ) : (
              <ul className="mt-2 grid gap-2 text-sm">
                {missing.map((item) => (
                  <li key={item} className="rounded-xl border border-amber-200/80 bg-sand-soft p-3">
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>
    </section>
  );
}

export function EligibilityPanel({ data }: { data: Workspace }) {
  const requirementById = new Map(data.requirements.map((item) => [item.id, item]));

  return (
    <section id="eligibility" className="mt-8 scroll-mt-8">
      <Card className="p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Can I apply?</p>
        <h2 className="mt-2 font-display text-2xl">Eligibility</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Each requirement is evaluated on its own. Unknown never becomes a false match. Assistance only — not an
          official decision.
        </p>
        <ul className="mt-6 grid gap-3">
          {data.eligibility.length === 0 ? (
            <li>
              <EmptyState
                eyebrow="Empty"
                title="No requirements yet"
                body="Add a requirement from the posting so eligibility has something to check."
              />
            </li>
          ) : (
            data.eligibility.map((item) => {
              const requirement = requirementById.get(item.requirement_id);
              const text = item.requirement_text || requirement?.text || "Requirement";
              const kind = item.requirement_kind || requirement?.kind || "general";
              return (
                <li key={item.id} className="rounded-2xl border border-line p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={eligibilityTone(item.state)}>
                      {eligibilityLabel(item.state)}
                    </StatusPill>
                    <SemanticBadge status={eligibilitySemanticStatus(item.state)} />
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">{kind}</span>
                    {requirement?.hard ? <StatusPill tone="coral">Hard</StatusPill> : null}
                    {item.needs_confirmation ? <StatusPill tone="sand">Needs confirmation</StatusPill> : null}
                  </div>
                  <p className="mt-3 text-sm font-medium">{text}</p>
                  <p className="mt-2 text-sm text-ink-muted">{item.explanation}</p>
                  {item.state === "unclear" || item.state === "not_met" || item.needs_confirmation ? (
                    <p className="mt-3 text-sm">
                      <Link href="/app/memory" className="text-teal underline">
                        Add matching facts to Application Memory
                      </Link>
                    </p>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
        <form action={addRequirement} className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <input type="hidden" name="applicationId" value={data.application.id} />
          <Field label="Add requirement" htmlFor={`requirement-${data.application.id}`}>
            <Input
              id={`requirement-${data.application.id}`}
              name="text"
              required
              placeholder="Must be available full-time"
            />
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="hard" />
            Hard
          </label>
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </form>
      </Card>
    </section>
  );
}

export function ResumeMatchPanel({ data }: { data: Workspace }) {
  const documents = new Map(data.documents.map((item) => [item.id, item]));

  return (
    <section id="resumes" className="mt-8 scroll-mt-8">
      <Card className="p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">Which resume?</p>
        <h2 className="mt-2 font-display text-2xl">Resume matching</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Variants are ranked against this opportunity. Rankings never invent experience that is not on the file or in
          verified memory.
        </p>
        {data.resumeMatches.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              eyebrow="Empty"
              title="No resumes to rank"
              body="Upload resume variants in Documents, then refresh intelligence."
            />
            <Link href="/app/resumes" className="mt-3 inline-block text-sm text-teal underline">
              Open resumes
            </Link>
          </div>
        ) : (
          <ul className="mt-6 grid gap-3">
            {data.resumeMatches.map((item) => {
              const document = documents.get(item.document_id);
              return (
                <li key={item.id} className="rounded-2xl border border-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{item.label || document?.label || "Resume"}</p>
                      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                        {(item.focus || "general").replace("_", " ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.recommended ? <StatusPill tone="mint">Recommended</StatusPill> : null}
                      <p className="font-mono text-2xl">{item.score}%</p>
                    </div>
                  </div>
                  {item.explanation ? <p className="mt-3 text-sm text-ink-muted">{item.explanation}</p> : null}
                  {(item.strengths ?? []).length > 0 ? (
                    <ul className="mt-3 grid gap-1 text-sm">
                      {(item.strengths ?? []).map((strength: string) => (
                        <li key={strength}>+ {strength}</li>
                      ))}
                    </ul>
                  ) : null}
                  {(item.gaps ?? []).length > 0 ? (
                    <ul className="mt-2 grid gap-1 text-sm text-ink-muted">
                      {(item.gaps ?? []).map((gap: string) => (
                        <li key={gap}>— {gap}</li>
                      ))}
                    </ul>
                  ) : null}
                  {item.suggestion ? (
                    <p className="mt-3 rounded-xl border border-dashed border-violet-200 bg-violet-soft p-3 text-sm">
                      {item.suggestion}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}
