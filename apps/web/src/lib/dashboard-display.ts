import { normalizeApplicationStatus } from "@/lib/application-workflow";
import { APPLICATION_LIFECYCLE_ACTIONS } from "@/lib/application-lifecycle";

export function applicationTableMeta(status: string, nextAction: string | null) {
  const normalized = normalizeApplicationStatus(status as never) ?? "saved";
  const action = (nextAction ?? "").trim();
  const needsYou =
    normalized === "review_required" ||
    action === APPLICATION_LIFECYCLE_ACTIONS.NEEDS_YOU ||
    (Boolean(action) &&
      /unclear|missing fact|verify evidence|needs confirmation|action required|needs you/i.test(action) &&
      !/review analyzed requirements/i.test(action));

  if (needsYou) {
    return { filter: "needs_you" as const, statusLabel: "Needs you", statusTone: "coral" as const };
  }
  if (action === APPLICATION_LIFECYCLE_ACTIONS.FILLING) {
    return { filter: "in_flight" as const, statusLabel: "Filling", statusTone: "teal" as const };
  }
  if (action === APPLICATION_LIFECYCLE_ACTIONS.STOPPED_CONTINUING) {
    return { filter: "in_flight" as const, statusLabel: "Continuing", statusTone: "teal" as const };
  }
  if (["analyzing", "in_progress", "ready_to_apply", "saved"].includes(normalized)) {
    return {
      filter: "in_flight" as const,
      statusLabel:
        normalized === "analyzing"
          ? "Analyzing"
          : normalized === "ready_to_apply"
            ? "Ready to apply"
            : normalized === "in_progress"
              ? "In progress"
              : "Saved",
      statusTone: normalized === "saved" ? ("sand" as const) : ("teal" as const),
    };
  }
  if (["rejected", "withdrawn"].includes(normalized)) {
    return {
      filter: "failed" as const,
      statusLabel: normalized === "rejected" ? "Rejected" : "Withdrawn",
      statusTone: "coral" as const,
    };
  }
  if (normalized === "archived") {
    return { filter: "skipped" as const, statusLabel: "Archived", statusTone: "muted" as const };
  }
  if (normalized === "submitted" || action === APPLICATION_LIFECYCLE_ACTIONS.SUBMITTED) {
    return { filter: "all" as const, statusLabel: "Submitted", statusTone: "mint" as const };
  }
  if (["under_review", "interview", "accepted"].includes(normalized)) {
    return {
      filter: "all" as const,
      statusLabel: normalized === "under_review" ? "Under review" : normalized === "interview" ? "Interview" : "Accepted",
      statusTone: "mint" as const,
    };
  }
  return { filter: "in_flight" as const, statusLabel: String(normalized).replace(/_/g, " "), statusTone: "sand" as const };
}

export function relativeTimeLabel(iso: string | null, fallbackIso: string) {
  const value = iso ?? fallbackIso;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}

export function companyFromOpportunity(opportunity: {
  organization?: string | null;
  source_url?: string | null;
  canonical_url?: string | null;
  title?: string | null;
} | null) {
  if (opportunity?.organization?.trim()) return opportunity.organization.trim();
  for (const raw of [opportunity?.canonical_url, opportunity?.source_url]) {
    if (!raw) continue;
    try {
      return new URL(raw).hostname.replace(/^www\./, "");
    } catch {
      /* ignore */
    }
  }
  return opportunity?.title?.trim() || "Opportunity";
}

export function sourceLabelFromOpportunity(opportunity: { source?: string | null } | null) {
  if (opportunity?.source === "extension") return "Extension";
  return null;
}

export type DashboardDocStatus = "Not required" | "Missing" | "Ready";

function isResumeLabel(label: string) {
  return /\b(resume|cv|curriculum\s*vitae)\b/i.test(label);
}

function isCoverLabel(label: string) {
  return /\b(cover\s*letter|covering\s*letter|motivation\s*letter)\b/i.test(label);
}

/**
 * Real resume / cover-letter column values for the dashboard table.
 * Driven by opportunity required documents + what is attached to the application.
 */
export function dashboardDocumentStatuses(input: {
  requiredLabels: string[];
  attachedLabels: string[];
}): { resume: DashboardDocStatus; cover: DashboardDocStatus } {
  const required = input.requiredLabels.map((label) => label.trim()).filter(Boolean);
  const attached = input.attachedLabels.map((label) => label.trim().toLowerCase()).filter(Boolean);

  const resumeRequired = required.some(isResumeLabel);
  const coverRequired = required.some(isCoverLabel);

  const resumeAttached = attached.some(isResumeLabel);
  const coverAttached = attached.some(isCoverLabel);

  const status = (requiredDoc: boolean, attachedDoc: boolean): DashboardDocStatus => {
    if (!requiredDoc) return "Not required";
    return attachedDoc ? "Ready" : "Missing";
  };

  return {
    resume: status(resumeRequired, resumeAttached),
    cover: status(coverRequired, coverAttached),
  };
}

