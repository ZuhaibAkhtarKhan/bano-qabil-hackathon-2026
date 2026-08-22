import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20260818000000_init.sql"),
  "utf8",
);

const userOwnedTables = [
  "profile_facts",
  "experiences",
  "evidence_items",
  "documents",
  "document_versions",
  "document_chunks",
  "opportunities",
  "requirements",
  "applications",
  "application_questions",
  "answer_versions",
  "application_documents",
  "eligibility_results",
  "submission_snapshots",
  "contacts",
  "reminders",
  "jobs",
];

describe("foundation RLS migration", () => {
  it("enables RLS on every user-owned table", () => {
    for (const table of ["profiles", ...userOwnedTables, "audit_events"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security;`);
    }
  });

  it("scopes user-owned tables by user_id and never leaves a public grant-all policy", () => {
    expect(migration).not.toContain("using (true)");
    expect(migration).not.toContain("with check (true)");
    for (const table of userOwnedTables) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toMatch(new RegExp(`create table public.${table}[\\s\\S]*?user_id uuid not null`));
      expect(migration).toContain(`user_id = auth.uid()`);
    }
  });

  it("keeps document objects private and user-folder scoped", () => {
    expect(migration).toContain("values ('application-documents', 'application-documents', false)");
    expect(migration).toContain("(storage.foldername(name))[1] = auth.uid()::text");
  });

  it("does not let clients insert jobs or audit events", () => {
    expect(migration).toContain("create policy jobs_select_own");
    expect(migration).not.toContain("create policy jobs_insert");
    expect(migration).toContain("create policy audit_events_select_own");
    expect(migration).not.toContain("create policy audit_events_insert");
  });

  it("lets a user delete their own profile row for account deletion", () => {
    const deletion = readFileSync(
      path.resolve(__dirname, "../../../../supabase/migrations/20260819180000_account_deletion.sql"),
      "utf8",
    );
    expect(deletion).toContain("create policy profiles_delete_own");
    expect(deletion).toContain("id = auth.uid()");
  });
});
