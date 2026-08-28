import { z } from "zod";

import { tryGetAiProvider } from "@/infra/ai/openai";
import { logError } from "@/lib/log";
import {
  detectProfileMemoryField,
  type ProfileMemoryField,
} from "@/lib/needs-you";

export type EligibilityGap = {
  id: string;
  requirementText: string;
  requirementKind: string;
  explanation: string;
  state: string;
};

export type EligibilityCandidate = {
  id: string;
  kind: "profile" | "mapping" | "question";
  label: string;
  currentValue?: string | null;
  profileField?: ProfileMemoryField | null;
  mappingId?: string;
  questionId?: string;
  answerId?: string | null;
};

export type EligibilityActionTarget = EligibilityCandidate & {
  gapId: string;
  reason: string;
};

const schema = z.object({
  actions: z.array(
    z.object({
      gapId: z.string(),
      candidateId: z.string().nullable(),
      reason: z.string(),
      canRectifyByEditing: z.boolean(),
    }),
  ),
});

const PROFILE_CANDIDATES: Array<{ field: ProfileMemoryField; label: string }> = [
  { field: "location_country", label: "Country of residence" },
  { field: "location_city", label: "City / location" },
  { field: "work_authorization", label: "Work authorization / visa" },
  { field: "display_name", label: "Full name" },
  { field: "phone", label: "Phone number" },
];

function heuristicTargets(
  gap: EligibilityGap,
  candidates: EligibilityCandidate[],
): EligibilityActionTarget[] {
  const blob = `${gap.requirementKind} ${gap.requirementText} ${gap.explanation}`.toLowerCase();
  const picks: EligibilityActionTarget[] = [];

  const want = (pred: (c: EligibilityCandidate) => boolean, reason: string) => {
    for (const candidate of candidates.filter(pred).slice(0, 2)) {
      picks.push({ ...candidate, gapId: gap.id, reason });
    }
  };

  if (/location|country|nation|citizenship|reside|submission.?from|other country/i.test(blob)) {
    want(
      (c) =>
        c.profileField === "location_country" ||
        c.profileField === "location_city" ||
        /country|location|city|nation|reside/i.test(c.label),
      "Location / country must match the eligibility requirement.",
    );
  }
  if (/visa|work.?auth|citizen|authorized to work|permit/i.test(blob)) {
    want(
      (c) => c.profileField === "work_authorization" || /visa|authorization|citizen/i.test(c.label),
      "Work authorization must satisfy the eligibility requirement.",
    );
  }
  if (/education|degree|university|gpa|graduate/i.test(blob)) {
    want(
      (c) => /education|university|degree|school|gpa/i.test(c.label) || c.kind === "question",
      "Education details may need to change for eligibility.",
    );
  }

  if (picks.length === 0 && candidates.length > 0) {
    // Prefer profile field inferred from requirement text.
    const profile = detectProfileMemoryField(gap.requirementText) ?? detectProfileMemoryField(gap.explanation);
    if (profile) {
      want((c) => c.profileField === profile, "Update this Application Memory field to re-check eligibility.");
    }
  }

  return picks;
}

/**
 * Map eligibility problems to concrete Need You targets (profile / mapping / question)
 * the applicant can edit so Fit can clear — or surface delete when nothing is editable.
 */
export async function resolveEligibilityActionTargets(input: {
  gaps: EligibilityGap[];
  candidates: EligibilityCandidate[];
}): Promise<{
  targets: EligibilityActionTarget[];
  /** Gaps with no editable candidate — still show explanation + delete CTA */
  unresolvedGaps: EligibilityGap[];
}> {
  const gaps = input.gaps.slice(0, 8);
  const candidates = input.candidates.slice(0, 40);
  if (gaps.length === 0) return { targets: [], unresolvedGaps: [] };

  const byCandidate = new Map(candidates.map((c) => [c.id, c]));
  const targets: EligibilityActionTarget[] = [];
  const resolvedGapIds = new Set<string>();

  const provider = tryGetAiProvider();
  if (provider && candidates.length > 0) {
    try {
      const raw = await provider.completeStructured({
        schemaName: "eligibilityNeedsYouActions",
        instruction: `You help an applicant fix eligibility blockers on a job application.

For each eligibility gap, pick which existing form/memory field (candidate) they should change so eligibility can be re-checked. Prefer the smallest concrete edit (country, city, visa, education answer).

Return JSON: { "actions": [ { "gapId", "candidateId", "reason", "canRectifyByEditing" } ] } for EVERY gapId.

Rules:
- candidateId MUST be one of the provided candidate ids, or null if none apply.
- canRectifyByEditing=false when the applicant clearly cannot meet a hard restriction by editing (e.g. country ban and location is already correct / cannot change).
- Never invent new fields or answers.
- reason: one short sentence for the UI.`,
        untrustedData: JSON.stringify({
          gaps: gaps.map((g) => ({
            id: g.id,
            kind: g.requirementKind,
            requirement: g.requirementText.slice(0, 400),
            explanation: g.explanation.slice(0, 500),
            state: g.state,
          })),
          candidates: candidates.map((c) => ({
            id: c.id,
            kind: c.kind,
            label: c.label.slice(0, 160),
            currentValue: (c.currentValue ?? "").slice(0, 200),
          })),
        }),
      });

      const parsed = schema.safeParse(raw);
      if (parsed.success) {
        for (const action of parsed.data.actions) {
          if (!action.canRectifyByEditing || !action.candidateId) continue;
          const candidate = byCandidate.get(action.candidateId);
          if (!candidate) continue;
          targets.push({
            ...candidate,
            gapId: action.gapId,
            reason: action.reason.slice(0, 280) || "Update this answer to re-check eligibility.",
          });
          resolvedGapIds.add(action.gapId);
        }
        // Mark gaps the model said cannot be edited as unresolved
        for (const action of parsed.data.actions) {
          if (!action.canRectifyByEditing) resolvedGapIds.add(action.gapId);
        }
      }
    } catch (error) {
      logError("needs_you.eligibility_actions_ai_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  for (const gap of gaps) {
    if (resolvedGapIds.has(gap.id)) continue;
    const heuristic = heuristicTargets(gap, candidates);
    if (heuristic.length > 0) {
      targets.push(...heuristic);
      resolvedGapIds.add(gap.id);
    }
  }

  const unresolvedGaps = gaps.filter((gap) => !targets.some((t) => t.gapId === gap.id));
  return { targets, unresolvedGaps };
}

export function defaultProfileCandidates(): EligibilityCandidate[] {
  return PROFILE_CANDIDATES.map((item) => ({
    id: `profile:${item.field}`,
    kind: "profile" as const,
    label: item.label,
    profileField: item.field,
    currentValue: null,
  }));
}
