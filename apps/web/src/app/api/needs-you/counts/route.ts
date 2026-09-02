import { NextResponse } from "next/server";

import { requireWorkspace } from "@/server/auth/require-workspace";
import { loadNeedsYouBadgeCounts } from "@/server/needs-you/queries";

export async function GET() {
  try {
    await requireWorkspace();
    const counts = await loadNeedsYouBadgeCounts();
    return NextResponse.json(counts);
  } catch {
    return NextResponse.json({ applicationCount: 0, totalFields: 0, fieldCountByApplicationId: {} });
  }
}
