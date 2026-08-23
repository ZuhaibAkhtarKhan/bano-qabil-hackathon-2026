import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("realtime system & migration", () => {
  it("includes supabase_realtime publication with all workflow tables", () => {
    const migrationSql = readFileSync(
      path.resolve(
        __dirname,
        "../../../../supabase/migrations/20260819190000_realtime_events.sql",
      ),
      "utf-8",
    );

    expect(migrationSql).toContain("create publication supabase_realtime");
    expect(migrationSql).toContain("alter publication supabase_realtime add table public.notifications");
    expect(migrationSql).toContain("alter publication supabase_realtime add table public.applications");
    expect(migrationSql).toContain("alter publication supabase_realtime add table public.jobs");
    expect(migrationSql).toContain("alter publication supabase_realtime add table public.application_answers");
    expect(migrationSql).toContain("alter table public.notifications replica identity full");
  });

  it("exports RealtimeToastContainer and RealtimeWorkspaceProvider", async () => {
    const toastModule = await import("../../src/components/app/realtime-toast");
    const providerModule = await import("../../src/components/app/realtime-provider");

    expect(typeof toastModule.RealtimeToastContainer).toBe("function");
    expect(typeof providerModule.RealtimeWorkspaceProvider).toBe("function");
    expect(typeof providerModule.useRealtime).toBe("function");
  });

  it("exports useRealtimeJob hook", async () => {
    const hookModule = await import("../../src/hooks/use-realtime-job");
    expect(typeof hookModule.useRealtimeJob).toBe("function");
  });
});
