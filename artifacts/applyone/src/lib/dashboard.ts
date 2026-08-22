import { computeDeadlineInfo, prioritizeApplications, type DeadlineUrgency } from "@1apply/domain";

import { normalizeApplicationStatus } from "@/lib/application-workflow";
import { asOne, type ApplicationListRow } from "@/server/types";

export function dashboardBuckets(applications: ApplicationListRow[], now = Date.now()) {
  const active = applications.filter((row) =>
    ["saved", "analyzing", "ready_to_apply", "in_progress", "review_required"].includes(
      normalizeApplicationStatus(row.status),
    ),
  );
  const submitted = applications.filter((row) => normalizeApplicationStatus(row.status) === "submitted");
  const interviews = applications.filter((row) =>
    ["under_review", "interview"].includes(normalizeApplicationStatus(row.status)),
  );
  const deadlines = applications
    .filter((row) => {
      const normalized = normalizeApplicationStatus(row.status);
      if (!row.deadline_at || ["rejected", "withdrawn", "archived", "accepted"].includes(normalized)) return false;
      return new Date(row.deadline_at).getTime() >= now;
    })
    .slice()
    .sort((a, b) => new Date(a.deadline_at ?? 0).getTime() - new Date(b.deadline_at ?? 0).getTime());
  const attention = applications.filter((row) => {
    if (normalizeApplicationStatus(row.status) === "review_required") return true;
    return Boolean(row.next_action && /review|unclear|missing|verify|evidence/i.test(row.next_action));
  });

  const prioritized = prioritizeApplications(
    applications.map((row) => ({
      id: row.id,
      status: row.status,
      deadlineAt: row.deadline_at,
      completenessPercent: 50,
    })),
    new Date(now),
  );

  return {
    active,
    submitted,
    interviews,
    deadlines,
    attention,
    recent: applications.slice(0, 8),
    prioritized,
  };
}

export function deadlineUrgencyLabel(urgency: DeadlineUrgency): string {
  switch (urgency) {
    case "overdue": return "Overdue";
    case "imminent": return "Due today";
    case "soon": return "Due soon";
    case "upcoming": return "Upcoming";
    default: return "";
  }
}

export function deadlineUrgencyTone(urgency: DeadlineUrgency): "coral" | "sand" | "mint" | "muted" {
  switch (urgency) {
    case "overdue": return "coral";
    case "imminent": return "coral";
    case "soon": return "sand";
    case "upcoming": return "mint";
    default: return "muted";
  }
}

export { computeDeadlineInfo };

export function applicationTitle(row: ApplicationListRow) {
  return asOne(row.opportunities)?.title ?? "Untitled opportunity";
}

export function applicationHost(row: ApplicationListRow) {
  return asOne(row.opportunities)?.organization ?? "Unknown host";
}
