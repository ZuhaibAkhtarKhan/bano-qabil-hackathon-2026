import { describe, expect, it } from "vitest";

import {
  assertSafePathSegment,
  assertUploadMagicBytes,
  chunkDocumentText,
  resolveUploadMimeType,
  sanitizeFileName,
  UploadValidationError,
} from "@/lib/documents/upload-security";
import { nextVersionLabel } from "@/lib/documents/versioning";
import { documentStoragePath } from "@/infra/storage/documents";
import { createDocumentReadUrl } from "@/infra/storage/documents";
import { evidenceEmbeddingContent } from "@/services/embeddings";

describe("upload security", () => {
  it("sanitizes filenames and blocks traversal segments", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("My Resume (final).pdf")).toBe("My-Resume-final-.pdf");
    expect(() => assertSafePathSegment("../bad")).toThrow(UploadValidationError);
  });

  it("requires extension and reported mime types to agree", () => {
    expect(resolveUploadMimeType("resume.pdf", "application/pdf")).toBe("application/pdf");
    expect(resolveUploadMimeType("notes.txt", "application/octet-stream")).toBe("text/plain");
    expect(resolveUploadMimeType("virus.exe", "application/pdf")).toBeNull();
    expect(resolveUploadMimeType("resume.pdf", "text/plain")).toBeNull();
  });

  it("rejects spoofed PDF magic bytes", () => {
    expect(() => assertUploadMagicBytes(Buffer.from("not a pdf"), "application/pdf")).toThrow(UploadValidationError);
    expect(() => assertUploadMagicBytes(Buffer.from("%PDF-1.7"), "application/pdf")).not.toThrow();
  });

  it("refuses encrypted PDFs and skips extraction when AI is not configured", async () => {
    const encrypted = Buffer.from("%PDF-1.4\n/Encrypt 12 0 R\nstream\nBT (secret) Tj ET\nendstream\n", "utf8");
    const { extractDocumentText, extractPdfText } = await import("@/lib/documents/extract-text");
    expect(await extractPdfText(encrypted)).toBeNull();
    expect(await extractDocumentText(encrypted, "application/pdf")).toBeNull();
  });

  it("chunks long text without dropping content boundaries", () => {
    const text = "a".repeat(5000);
    const chunks = chunkDocumentText(text, 1600, 10);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("").length).toBe(5000);
  });
});

describe("version labels", () => {
  it("increments version labels without reusing numbers", () => {
    expect(nextVersionLabel(["v1"])).toBe("v2");
    expect(nextVersionLabel(["v1", "v2", "v3"])).toBe("v4");
    expect(nextVersionLabel([])).toBe("v1");
  });
});

describe("private storage paths", () => {
  it("scopes files under the user id and sanitized filename", () => {
    const path = documentStoragePath({
      actor: {
        userId: "22222222-2222-4222-8222-222222222222",
        email: "b@example.com",
        profile: {
          id: "22222222-2222-4222-8222-222222222222",
          email: "b@example.com",
          display_name: "B",
          headline: null,
          phone: null,
          terms_accepted_at: null,
          ai_processing_accepted_at: null,
          onboarding_completed_at: null,
          onboarding_step: "consent",
          preferences: {},
          timezone: null,
        },
      },
      documentId: "doc",
      versionId: "ver",
      type: "resume_variant",
      fileName: "../../secret.txt",
    });
    expect(path.startsWith("22222222-2222-4222-8222-222222222222/resume-variants/")).toBe(true);
    expect(path).not.toContain("..");
  });

  it("rejects cross-user signed url paths", async () => {
    const supabase = {
      storage: {
        from: () => ({
          createSignedUrl: async () => ({ data: { signedUrl: "https://example.com/file" }, error: null }),
        }),
      },
    } as never;
    await expect(
      createDocumentReadUrl(supabase, { userId: "user-a" } as never, "user-b/resumes/x/y/z.pdf"),
    ).rejects.toThrow("FORBIDDEN");
  });
});

describe("embedding content", () => {
  it("builds searchable corpus text from evidence rows", () => {
    const content = evidenceEmbeddingContent({
      title: "Built retrieval pipeline",
      kind: "project",
      organization: "1-Apply",
      situation: "Needed grounded drafts",
      action: "Indexed verified evidence",
      outcome: "Reduced hallucinations",
      skills: ["pgvector", "typescript"],
    });
    expect(content).toContain("retrieval");
    expect(content).toContain("pgvector");
  });
});
