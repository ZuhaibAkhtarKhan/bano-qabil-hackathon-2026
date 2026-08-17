"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";

import { logError } from "@/lib/log";
import { requireWorkspace } from "@/server/auth/require-workspace";
import { documentStoragePath } from "@/infra/storage/documents";
import { loadAppConfig } from "@/config/env";
import { redirectWith } from "@/server/http/flash";
import { runOwnedJob } from "@/server/jobs/runner";
import { extractFromDocumentText } from "@/server/memory/extract-from-document";

const MAX_BYTES = 8 * 1024 * 1024;
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);
const ALLOWED_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function mimeFromName(name: string, reported: string): string {
  const lower = name.toLowerCase();
  if (reported && ALLOWED_TYPES.has(reported)) return reported;
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return reported;
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 0 && chunks.length < 40) {
    chunks.push(remaining.slice(0, 1600));
    remaining = remaining.slice(1600);
  }
  return chunks;
}

export async function uploadOnboardingResume(formData: FormData) {
  const { user, profile, supabase, actor } = await requireWorkspace();
  const file = formData.get("file");
  const label = String(formData.get("label") ?? "Primary resume").trim() || "Primary resume";

  if (!(file instanceof File) || file.size === 0) {
    redirectWith("/app/onboarding/documents", { error: "required" });
  }
  if (file.size > MAX_BYTES) {
    redirectWith("/app/onboarding/documents", { error: "upload" });
  }

  const mimeType = mimeFromName(file.name, file.type);
  if (!ALLOWED_TYPES.has(mimeType)) {
    redirectWith("/app/onboarding/documents", { error: "upload" });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(buffer).digest("hex");
  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const storagePath = documentStoragePath({
    actor,
    documentId,
    versionId,
    type: "resume",
    fileName: file.name,
  });
  const bucket = loadAppConfig().storageBucket;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, buffer, { contentType: mimeType, upsert: false });

  if (uploadError) {
    logError("onboarding.upload_failed", { code: uploadError.message });
    redirectWith("/app/onboarding/documents", { error: "upload" });
  }

  const { error: documentError } = await supabase.from("documents").insert({
    id: documentId,
    user_id: user.id,
    type: "resume",
    label,
  });
  if (documentError) {
    await supabase.storage.from(bucket).remove([storagePath]);
    redirectWith("/app/onboarding/documents", { error: "save" });
  }

  const { error: versionError } = await supabase.from("document_versions").insert({
    id: versionId,
    document_id: documentId,
    user_id: user.id,
    version_label: "v1",
    storage_path: storagePath,
    file_hash: fileHash,
    mime_type: mimeType,
    byte_size: file.size,
    status: "processing",
  });

  if (versionError) {
    await supabase.from("documents").delete().eq("id", documentId);
    await supabase.storage.from(bucket).remove([storagePath]);
    redirectWith("/app/onboarding/documents", { error: "save" });
  }

  await supabase.from("documents").update({ current_version_id: versionId }).eq("id", documentId);
  await supabase.from("resumes").upsert({ document_id: documentId, user_id: user.id }, { onConflict: "document_id" });

  const isText = TEXT_TYPES.has(mimeType);
  const extractedText = isText ? buffer.toString("utf8").slice(0, 80_000) : null;
  let notice: "uploaded" | "extracted" | "binary_stored" = isText ? "extracted" : "binary_stored";

  await runOwnedJob(
    supabase,
    { actor, type: "document_extract", inputRef: versionId },
    async () => {
      if (extractedText) {
        const chunks = chunkText(extractedText);
        if (chunks.length > 0) {
          await supabase.from("document_chunks").insert(
            chunks.map((content, index) => ({
              user_id: user.id,
              document_version_id: versionId,
              chunk_index: index,
              content,
            })),
          );
        }

        await extractFromDocumentText({
          supabase,
          userId: user.id,
          documentId,
          versionId,
          documentLabel: label,
          extractedText,
          profileDisplayName: profile.display_name,
        });
      }

      await supabase.from("document_versions").update({ status: "ready" }).eq("id", versionId);
    },
  );

  await supabase
    .from("profiles")
    .update({
      onboarding_step: "review",
      preferences: {
        ...((profile.preferences as Record<string, unknown> | null) ?? {}),
        onboardingSkippedDocuments: false,
      },
    })
    .eq("id", user.id);

  if (!isText) notice = "binary_stored";

  revalidatePath("/app/onboarding");
  revalidatePath("/app/memory");
  revalidatePath("/app/documents");
  redirectWith("/app/onboarding/review", { notice });
}
