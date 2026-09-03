import { readFileSync } from "node:fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { assertOwnedMemory } from "@1apply/domain";

import type { Actor } from "@/auth/actor";
import { createDocumentReadUrl, documentStoragePath } from "@/infra/storage/documents";
import { assertOwnedDocument, assertOwnedVersion } from "@/server/documents/service";
import { loadOwnedEvidence, vectorSearch } from "@/services/retrieval";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function actor(userId: string): Actor {
  return {
    userId,
    email: `${userId}@example.com`,
    profile: {
      id: userId,
      email: `${userId}@example.com`,
      display_name: "A",
      headline: null,
      phone: null,
      terms_accepted_at: "2026-01-01T00:00:00.000Z",
      ai_processing_accepted_at: "2026-01-01T00:00:00.000Z",
      onboarding_completed_at: "2026-01-01T00:00:00.000Z",
      onboarding_step: "done",
      preferences: {},
      timezone: null,
    },
  };
}

function chain(result: { data: unknown; error: null }) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => result,
    then: undefined as undefined,
  };
  return query;
}

describe("cross-user data exposure = 0", () => {
  it("does not let User A treat User B memory rows as owned", () => {
    expect(() => assertOwnedMemory(USER_A, USER_B)).toThrow(/MEMORY_FORBIDDEN/);
    expect(() => assertOwnedMemory(USER_A, USER_A)).not.toThrow();
  });

  it("rejects User B document metadata for User A", async () => {
    const supabase = {
      from: () =>
        chain({
          data: { id: "doc-b", type: "resume", label: "B resume", current_version_id: "v1", user_id: USER_B },
          error: null,
        }),
    } as never;
    await expect(assertOwnedDocument(supabase, actor(USER_A), "doc-b")).rejects.toThrow("DOCUMENT_FORBIDDEN");
    await expect(assertOwnedVersion(supabase, actor(USER_A), "ver-b")).rejects.toThrow("DOCUMENT_FORBIDDEN");
  });

  it("refuses signed URLs that point at another user's storage prefix", async () => {
    await expect(
      createDocumentReadUrl({} as never, actor(USER_A), `${USER_B}/resumes/x/y/z.pdf`),
    ).rejects.toThrow("FORBIDDEN");
    expect(
      documentStoragePath({
        actor: actor(USER_A),
        documentId: "doc",
        versionId: "ver",
        type: "resume",
        fileName: "cv.pdf",
      }).startsWith(`${USER_A}/`),
    ).toBe(true);
  });

  it("loads evidence only with an owner filter and never returns User B rows", async () => {
    const filters: Array<{ column: string; value: unknown }> = [];
    const supabase = {
      from: (table: string) => {
        expect(table).toBe("evidence_items");
        return {
          select: () => ({
            eq: (column: string, value: unknown) => {
              filters.push({ column, value });
              return Promise.resolve({
                data: [
                  {
                    id: "ev-a",
                    title: "Mine",
                    kind: "project",
                    organization: null,
                    situation: null,
                    action: null,
                    outcome: null,
                    skills: [],
                    verification_status: "verified",
                    excluded_from_ai: false,
                    user_id: USER_A,
                  },
                ],
                error: null,
              });
            },
          }),
        };
      },
    } as never;
    const rows = await loadOwnedEvidence(supabase, actor(USER_A));
    expect(filters).toEqual([{ column: "user_id", value: USER_A }]);
    expect(rows.every((item) => item.id === "ev-a")).toBe(true);
  });

  it("searches embeddings only through the owner-scoped RPC", async () => {
    const calls: unknown[] = [];
    const supabase = {
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args });
        return { data: [], error: null };
      },
    } as never;
    await vectorSearch(supabase, [0, 1, 0], 8);
    expect(calls).toEqual([
      {
        name: "match_user_embeddings",
        args: { query_embedding: [0, 1, 0], match_count: 8, filter_source: null },
      },
    ]);
  });

  it("keeps profiles, documents, embeddings, applications, and answers owner-scoped in SQL and loaders", () => {
    const init = readFileSync(
      path.resolve(__dirname, "../../../../supabase/migrations/20260818000000_init.sql"),
      "utf8",
    );
    const architecture = readFileSync(
      path.resolve(__dirname, "../../../../supabase/migrations/20260818020000_architecture.sql"),
      "utf8",
    );
    const queries = readFileSync(
      path.resolve(__dirname, "../../src/server/workspace/queries.ts"),
      "utf8",
    );
    const applicationActions = readFileSync(
      path.resolve(__dirname, "../../src/server/applications/actions.ts"),
      "utf8",
    );
    const answerActions = readFileSync(
      path.resolve(__dirname, "../../src/server/answers/actions.ts"),
      "utf8",
    );
    const answerGenerate = readFileSync(
      path.resolve(__dirname, "../../src/server/answers/generate.ts"),
      "utf8",
    );
    const retrieval = readFileSync(
      path.resolve(__dirname, "../../src/services/retrieval.ts"),
      "utf8",
    );

    expect(init).toContain("create policy profiles_select_own");
    expect(init).toContain("create policy documents_select_own");
    expect(init).toContain("create policy applications_select_own");
    expect(init).toContain("create policy answer_versions_select_own");
    expect(init).toContain("user_id = auth.uid()");
    expect(architecture).toContain("where e.user_id = auth.uid()");
    expect(architecture).not.toContain("using (true)");

    expect(queries).toContain('.eq("user_id", profile.id)');
    expect(queries).toContain('.eq("user_id", user.id)');
    expect(applicationActions).toContain('.eq("user_id", userId)');
    expect(answerActions).toContain('.eq("user_id", actor.userId)');
    expect(answerGenerate).toContain('.eq("user_id", actor.userId)');
    expect(retrieval).toContain('.eq("user_id", actor.userId)');
  });
});
