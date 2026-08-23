import type { EligibilityDisplayState, EligibilityState } from "@1apply/domain";
import type { StatusTone } from "@/lib/status";

export const ELIGIBILITY_LABEL: Record<EligibilityState, EligibilityDisplayState> = {
  met: "SATISFIED",
  not_met: "NOT SATISFIED",
  unclear: "UNKNOWN",
  not_evaluated: "UNKNOWN",
  partial: "PARTIAL",
  needs_confirmation: "NEEDS CONFIRMATION",
};

export function eligibilityTone(state: string): StatusTone {
  if (state === "met" || state === "SATISFIED") return "mint";
  if (state === "not_met" || state === "NOT SATISFIED") return "coral";
  if (state === "partial" || state === "PARTIAL") return "teal";
  if (state === "needs_confirmation" || state === "NEEDS CONFIRMATION") return "sand";
  return "muted";
}

export function requirementKindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "education":
      return "Education";
    case "degree":
      return "Degree";
    case "graduation_year":
      return "Graduation year";
    case "location":
      return "Location";
    case "experience":
      return "Experience";
    case "skills":
    case "skill":
      return "Skills";
    case "availability":
      return "Availability";
    default:
      return "Other";
  }
}

export function shouldApplyCopy(value: string | null | undefined): { label: string; tone: StatusTone } {
  if (value === "apply") return { label: "Should I apply? Yes — strong verified fit", tone: "mint" };
  if (value === "consider") return { label: "Should I apply? Possibly — resolve unknowns first", tone: "sand" };
  if (value === "blocked") return { label: "Should I apply? Not yet — a hard requirement fails", tone: "coral" };
  if (value === "weak") return { label: "Should I apply? Weak verified overlap", tone: "muted" };
  return { label: "Should I apply? Run analysis to find out", tone: "muted" };
}
