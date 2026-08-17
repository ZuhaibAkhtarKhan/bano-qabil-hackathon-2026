import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { documentTypeSchema } from "@1apply/contracts";
import { freezeSubmissionManifest } from "@1apply/domain";

const migration = readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20260818050000_documents_evidence.sql"),
  "utf8",
);

describe("Phase 6 document types", () => {
  it("includes resume variants and supporting documents", () => {
    expect(documentTypeSchema.options).toContain("resume_variant");
    expect(documentTypeSchema.options).toContain("supporting_document");
  });
});

describe("Phase 6 migration", () => {
  it("adds version metadata and expands embedding sources", () => {
    expect(migration).toContain("original_filename");
    expect(migration).toContain("profile_facts");
    expect(migration).toContain("answer_versions");
    expect(migration).toContain("grant select, insert, update, delete on public.embeddings to authenticated");
    expect(migration).toContain("match_user_embeddings");
  });
});

describe("submission snapshots", () => {
  it("freezes exact document versions independently from latest uploads", () => {
    const manifest = freezeSubmissionManifest({
      answers: [{ questionId: "q1", answerVersionId: "a1" }],
      documents: [
        { documentId: "doc-resume", documentVersionId: "v2-old" },
        { documentId: "doc-cover", documentVersionId: "v1" },
      ],
    });

    expect(manifest.documentManifest).toEqual([
      { documentId: "doc-resume", documentVersionId: "v2-old" },
      { documentId: "doc-cover", documentVersionId: "v1" },
    ]);
    expect(manifest.answerManifest).toHaveLength(1);
  });
});

describe("retrieval service exports", () => {
  it("exposes grounded retrieval pipeline entry points", async () => {
    const mod = await import("@/services/retrieval");
    expect(typeof mod.retrieveForGrounding).toBe("function");
    expect(typeof mod.selectEvidenceForQuestion).toBe("function");
    expect(typeof mod.vectorSearch).toBe("function");
  });
});

describe("document service exports", () => {
  it("exposes versioning helpers", async () => {
    const mod = await import("@/server/documents/service");
    expect(typeof mod.addDocumentVersion).toBe("function");
    expect(typeof mod.setCurrentDocumentVersion).toBe("function");
    expect(typeof mod.assertOwnedDocument).toBe("function");
  });
});
