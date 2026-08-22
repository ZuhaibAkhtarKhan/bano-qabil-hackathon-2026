import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20260818020000_architecture.sql"),
  "utf8",
);

const tables = [
  "skills",
  "evidence_skills",
  "evidence_sources",
  "profile_links",
  "resumes",
  "opportunity_documents",
  "opportunity_questions",
  "answer_evidence",
  "application_events",
  "application_status_history",
  "fill_sessions",
  "field_mappings",
  "integrations",
  "email_events",
  "calendar_events",
  "ai_runs",
  "embeddings",
];

describe("architecture schema", () => {
  it("creates relational tables instead of one json blob", () => {
    for (const table of tables) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toMatch(new RegExp(`create table public.${table}[\\s\\S]*?user_id uuid not null`));
    }
  });

  it("enables RLS and owner policies without public grant-all", () => {
    expect(migration).toContain("alter table public.%I enable row level security");
    expect(migration).toContain("user_id = auth.uid()");
    expect(migration).not.toContain("using (true)");
    expect(migration).not.toContain("with check (true)");
  });

  it("scopes vector retrieval to the authenticated user before ranking", () => {
    expect(migration).toContain("create or replace function public.match_user_embeddings");
    expect(migration).toContain("where e.user_id = auth.uid()");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("order by e.embedding <=> query_embedding");
  });

  it("keeps snapshots and AI runs from storing raw prompts", () => {
    expect(migration).not.toContain("prompt_text");
    expect(migration).not.toContain("raw_output");
    expect(migration).toContain("create table public.ai_runs");
  });
});
