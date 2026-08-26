import { DashboardPackets } from "@/components/app/dashboard-packets";

export const dynamic = "force-dynamic";

/**
 * Most recent dashboard work is saadia's kit/packet + guide UI (ea19971).
 * zuhaib's match/table dashboard remains at `@/components/app/dashboard-home`.
 */
export default async function DashboardPage() {
  return <DashboardPackets />;
}
