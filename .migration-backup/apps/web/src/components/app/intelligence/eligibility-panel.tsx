import { StatusPill } from "@/components/ui/status-pill";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { eligibilityTone, requirementKindLabel, ELIGIBILITY_LABEL } from "@/lib/intelligence";
import { addRequirement } from "@/server/applications/actions";
import type { EligibilityState } from "@1apply/domain";

type EligibilityRow = {
  id: string;
  requirement_id: string;
  state: string;
  explanation: string;
  evidence_id: string | null;
  requirement_kind?: string | null;
  display_state?: string | null;
};

type RequirementRow = {
  id: string;
  text: string;
  hard: boolean;
  kind?: string | null;
};

export function EligibilityPanel({
  applicationId,
  eligibility,
  requirements,
}: {
  applicationId: string;
  eligibility: EligibilityRow[];
  requirements: RequirementRow[];
}) {
  const byId = new Map(requirements.map((item) => [item.id, item]));

  return (
    <Card id="eligibility" className="scroll-mt-8 p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">Eligibility</p>
      <h2 className="mt-2 font-display text-2xl">Can I apply?</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
        Each posting requirement is checked on its own. Missing facts stay UNKNOWN or NEEDS CONFIRMATION — they are
        never converted into a false match. Assistance only, not an official decision.
      </p>
      <ul className="mt-6 grid gap-3">
        {eligibility.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-line bg-canvas p-4 text-sm text-ink-muted">
            No requirements yet. Add them so eligibility has something to check.
          </li>
        ) : (
          eligibility.map((item) => {
            const requirement = byId.get(item.requirement_id);
            const state = (item.state ?? "unclear") as EligibilityState;
            const label = item.display_state || ELIGIBILITY_LABEL[state] || state.replaceAll("_", " ").toUpperCase();
            return (
              <li key={item.id} className="rounded-2xl border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{requirement?.text ?? item.explanation}</p>
                    <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                      {requirementKindLabel(item.requirement_kind ?? requirement?.kind)}
                      {requirement?.hard ? " · Hard" : ""}
                    </p>
                  </div>
                  <StatusPill tone={eligibilityTone(state)}>{label}</StatusPill>
                </div>
                <p className="mt-3 text-sm leading-6 text-ink-muted">{item.explanation}</p>
              </li>
            );
          })
        )}
      </ul>
      <form action={addRequirement} className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <input type="hidden" name="applicationId" value={applicationId} />
        <Field label="Add requirement" htmlFor={`requirement-${applicationId}`}>
          <Input id={`requirement-${applicationId}`} name="text" required placeholder="Must be available full-time" />
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
  );
}
