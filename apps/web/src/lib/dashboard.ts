import type { ApplicationStatus } from "@1apply/contracts";

import { asOne, type ApplicationListRow } from "@/server/types";

const ACTIVE: ApplicationStatus[] = ["draft", "preparing", "ready"];
const INTERVIEW: ApplicationStatus[] = ["interview", "assessment"];
const CLOSED: ApplicationStatus[] = ["rejected", "withdrawn", "archived"];

export function dashboardBuckets(applications: ApplicationListRow[], now = Date.now()) {
  const active = applications.filter((row) => ACTIVE.includes(row.status));
  const submitted = applications.filter((row) => row.status === "submitted");
  const interviews = applications.filter((row) => INTERVIEW.includes(row.status));
  const deadlines = applications
    .filter((row) => {
      if (!row.deadline_at || CLOSED.includes(row.status)) return false;
      return new Date(row.deadline_at).getTime() >= now;
    })
    .slice()
    .sort((a, b) => new Date(a.deadline_at ?? 0).getTime() - new Date(b.deadline_at ?? 0).getTime());
  const attention = applications.filter((row) => {
    if (row.status === "preparing") return true;
    return Boolean(row.next_action && /review|unclear|missing|verify|evidence/i.test(row.next_action));
  });

  return {
    active,
    submitted,
    interviews,
    deadlines,
    attention,
    recent: applications.slice(0, 8),
  };
}

export function applicationTitle(row: ApplicationListRow) {
  return asOne(row.opportunities)?.title ?? "Untitled opportunity";
}

export function applicationHost(row: ApplicationListRow) {
  return asOne(row.opportunities)?.organization ?? "Unknown host";
}
