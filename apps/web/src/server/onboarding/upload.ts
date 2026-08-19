"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";

import { extractTextFromBuffer } from "@/lib/documents/extract-text";
import { logError } from "@/lib/log";
import { requireWorkspace } from "@/server/auth/require-workspace";
import { documentStoragePath } from "@/infra/storage/documents";
import { loadAppConfig } from "@/config/env";
import { redirectWith } from "@/server/http/flash";
import { runOwnedJob } from "@/server/jobs/runner";
import { processDocumentVersion } from "@/server/documents/service";

const MAX_BYTES = 8 * 1024 * 1024;
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

  await runOwnedJob(
    supabase,
    { actor, type: "document_extract", inputRef: versionId },
    async () => {
      await processDocumentVersion({
        supabase,
        userId: user.id,
        documentId,
        versionId,
        documentLabel: label,
        profileDisplayName: profile.display_name,
        buffer,
        mimeType,
      });
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

  const notice = extractTextFromBuffer(buffer, mimeType) ? "extracted" : "binary_stored";

  revalidatePath("/app/onboarding");
  revalidatePath("/app/memory");
  revalidatePath("/app/documents");
  redirectWith("/app/onboarding/review", { notice });
}
