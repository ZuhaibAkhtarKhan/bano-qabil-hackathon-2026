import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20260818030000_grants_onboarding.sql"),
  "utf8",
);

describe("grants and onboarding migration", () => {
  it("grants authenticated role table access while RLS remains enabled", () => {
    expect(migration).toContain("grant select, insert, update, delete on all tables in schema public to authenticated");
    expect(migration).toContain("grant usage on schema public to anon, authenticated, service_role");
  });

  it("tracks onboarding step separately from completion", () => {
    expect(migration).toContain("onboarding_step");
    expect(migration).toContain("'consent', 'profile', 'documents', 'review', 'ready', 'done'");
  });
});
