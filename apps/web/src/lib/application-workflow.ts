import type { ApplicationStatus } from "@1apply/contracts";
import { requiredDocumentCovered } from "@1apply/domain";

export type NormalizedApplicationStatus =
  | "saved"
  | "analyzing"
  | "ready_to_apply"
  | "in_progress"
  | "review_required"
  | "submitted"
  | "under_review"
  | "interview"
  | "accepted"
  | "rejected"
  | "withdrawn"
  | "archived";

const LEGACY_TO_NORMALIZED: Record<ApplicationStatus, NormalizedApplicationStatus> = {
  saved: "saved",
  analyzing: "analyzing",
  ready_to_apply: "ready_to_apply",
  in_progress: "in_progress",
  review_required: "review_required",
  submitted: "submitted",
  under_review: "under_review",
  interview: "interview",
  accepted: "accepted",
  rejected: "rejected",
  withdrawn: "withdrawn",
  archived: "archived",
  draft: "saved",
  preparing: "analyzing",
  ready: "ready_to_apply",
  assessment: "under_review",
  offer: "accepted",
};

export const WORKFLOW_ORDER: readonly NormalizedApplicationStatus[] = [
  "saved",
  "analyzing",
  "ready_to_apply",
  "in_progress",
  "review_required",
  "submitted",
  "under_review",
  "interview",
  "accepted",
  "rejected",
  "withdrawn",
  "archived",
] as const;

export function normalizeApplicationStatus(status: ApplicationStatus): NormalizedApplicationStatus {
  return LEGACY_TO_NORMALIZED[status];
}

export function applicationStatusLabel(status: ApplicationStatus | NormalizedApplicationStatus): string {
  const normalized = normalizeApplicationStatus(status as ApplicationStatus);
  return normalized.replace(/_/g, " ");
}

const TRANSITIONS: Record<NormalizedApplicationStatus, readonly NormalizedApplicationStatus[]> = {
  saved: ["analyzing", "review_required", "archived"],
  analyzing: ["ready_to_apply", "review_required", "saved", "archived"],
  ready_to_apply: ["in_progress", "review_required", "submitted", "archived"],
  in_progress: ["review_required", "ready_to_apply", "submitted", "archived"],
  review_required: ["analyzing", "ready_to_apply", "in_progress", "submitted", "archived"],
  submitted: ["under_review", "interview", "accepted", "rejected", "withdrawn", "archived"],
  under_review: ["interview", "accepted", "rejected", "withdrawn", "archived"],
  interview: ["accepted", "rejected", "withdrawn", "archived"],
  accepted: ["archived"],
  rejected: ["archived"],
  withdrawn: ["archived"],
  archived: [],
};

export function allowedTransitions(status: ApplicationStatus): readonly NormalizedApplicationStatus[] {
  return TRANSITIONS[normalizeApplicationStatus(status)];
}

export function canTransitionTo(from: ApplicationStatus, to: NormalizedApplicationStatus): boolean {
  const normalizedFrom = normalizeApplicationStatus(from);
  return normalizedFrom === to || TRANSITIONS[normalizedFrom].includes(to);
}

export function workflowTone(
  status: ApplicationStatus,
): "muted" | "sand" | "mint" | "teal" | "violet" | "coral" {
  switch (normalizeApplicationStatus(status)) {
    case "saved":
      return "muted";
    case "analyzing":
    case "review_required":
      return "sand";
    case "ready_to_apply":
    case "accepted":
      return "mint";
    case "submitted":
    case "under_review":
      return "teal";
    case "in_progress":
    case "interview":
      return "violet";
    case "rejected":
      return "coral";
    case "withdrawn":
    case "archived":
      return "muted";
  }
}

export type ApplicationCompleteness = {
  percent: number;
  complete: number;
  total: number;
  remaining: string[];
  readyForSubmission: boolean;
};

export function computeApplicationCompleteness(input: {
  requiredQuestions: number;
  approvedAnswers: number;
  requiredDocuments: string[];
  attachedDocumentLabels: string[];
  eligibilityNeedsReview: string[];
  missingFitItems: string[];
  recommendedResumeSelected: boolean;
  fieldMappingsPending: number;
}): ApplicationCompleteness {
  const remaining: string[] = [];

  if (!input.recommendedResumeSelected) {
    remaining.push("recommended resume selection");
  }

  for (const label of input.requiredDocuments) {
    const covered = requiredDocumentCovered(
      label,
      input.attachedDocumentLabels.map((item) => ({ type: "other", label: item })),
    );
    if (!covered) remaining.push(label);
  }

  if (input.requiredQuestions > input.approvedAnswers) {
    remaining.push(`${input.requiredQuestions - input.approvedAnswers} required answer${input.requiredQuestions - input.approvedAnswers === 1 ? "" : "s"}`);
  }

  remaining.push(...input.eligibilityNeedsReview);
  remaining.push(...input.missingFitItems);

  if (input.fieldMappingsPending > 0) {
    remaining.push(`${input.fieldMappingsPending} autofill field${input.fieldMappingsPending === 1 ? "" : "s"} need review`);
  }

  const total =
    1 +
    input.requiredDocuments.length +
    input.requiredQuestions +
    input.eligibilityNeedsReview.length +
    input.missingFitItems.length +
    (input.fieldMappingsPending > 0 ? input.fieldMappingsPending : 0);

  const complete = Math.max(total - remaining.length, 0);
  const percent = total === 0 ? 100 : Math.round((complete / total) * 100);

  return {
    percent,
    complete,
    total,
    remaining,
    readyForSubmission: remaining.length === 0,
  };
}
