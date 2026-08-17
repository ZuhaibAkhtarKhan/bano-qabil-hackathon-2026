import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20260818010000_phase3.sql"),
  "utf8",
);

const tables = ["fit_evaluations", "resume_matches", "review_items", "notifications", "evidence_embeddings"];

describe("phase 3 RLS migration", () => {
  it("enables RLS and owner-scoped policies on new tables", () => {
    for (const table of tables) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security;`);
      expect(migration).toContain(`${table}_select_own`);
      expect(migration).toMatch(new RegExp(`create table public.${table}[\\s\\S]*?user_id uuid not null`));
    }
    expect(migration).not.toContain("using (true)");
    expect(migration).not.toContain("with check (true)");
  });

  it("lets the owning user enqueue jobs without a public grant-all", () => {
    expect(migration).toContain("create policy jobs_insert_own");
    expect(migration).toContain("create policy jobs_update_own");
    expect(migration).toContain("user_id = auth.uid()");
  });
});

describe("submission snapshot immutability", () => {
  it("does not add update or delete policies for snapshots in later migrations", () => {
    expect(migration).not.toContain("submission_snapshots_update");
    expect(migration).not.toContain("submission_snapshots_delete");
  });
});
