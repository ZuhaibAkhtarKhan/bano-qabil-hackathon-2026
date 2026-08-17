"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { documentTypeSchema } from "@1apply/contracts";

import { createDocumentReadUrl } from "@/infra/storage/documents";
import { logError } from "@/lib/log";
import { readValidatedUpload, UploadValidationError } from "@/lib/documents/upload-security";
import { requireWorkspace } from "@/server/auth/require-workspace";
import {
  addDocumentVersion,
  assertOwnedVersion,
  createDocumentWithVersion,
  processDocumentVersion,
  setCurrentDocumentVersion,
} from "@/server/documents/service";
import { redirectWith } from "@/server/http/flash";
import { runOwnedJob } from "@/server/jobs/runner";
import { reindexUserRetrievalCorpus } from "@/services/embeddings";

const DOCUMENTS = "/app/documents";

function documentPath(documentId: string) {
  return `${DOCUMENTS}/${documentId}`;
}

function mapUploadError(error: unknown): "required" | "upload" {
  if (error instanceof UploadValidationError) {
    return error.code === "required" ? "required" : "upload";
  }
  return "upload";
}

async function runVersionJobs(input: {
  supabase: Awaited<ReturnType<typeof requireWorkspace>>["supabase"];
  actor: Awaited<ReturnType<typeof requireWorkspace>>["actor"];
  userId: string;
  profileDisplayName: string | null;
  documentId: string;
  versionId: string;
  label: string;
  buffer: Buffer;
  mimeType: string;
}) {
  await runOwnedJob(
    input.supabase,
    { actor: input.actor, type: "document_extract", inputRef: input.versionId },
    async () => {
      await processDocumentVersion({
        supabase: input.supabase,
        userId: input.userId,
        documentId: input.documentId,
        versionId: input.versionId,
        documentLabel: input.label,
        profileDisplayName: input.profileDisplayName,
        buffer: input.buffer,
        mimeType: input.mimeType,
      });
    },
  );

  await runOwnedJob(
    input.supabase,
    { actor: input.actor, type: "embedding_index", inputRef: input.versionId },
    async () => {
      await reindexUserRetrievalCorpus(input.supabase, input.userId);
    },
  );
}

export async function uploadDocument(formData: FormData) {
  const { user, profile, supabase, actor } = await requireWorkspace();
  const file = formData.get("file");
  const label = String(formData.get("label") ?? "").trim();
  const typeParsed = documentTypeSchema.safeParse(String(formData.get("type") ?? "other"));

  if (!(file instanceof File) || !label || !typeParsed.success) {
    redirectWith(DOCUMENTS, { error: "required" });
  }

  let upload;
  try {
    upload = await readValidatedUpload(file);
  } catch (error) {
    redirectWith(DOCUMENTS, { error: mapUploadError(error) });
  }

  let documentId: string;
  let versionId: string;
  try {
    const created = await createDocumentWithVersion({
      supabase,
      actor,
      userId: user.id,
      type: typeParsed.data,
      label,
      upload,
    });
    if (created.duplicate) {
      redirectWith(DOCUMENTS, { notice: "duplicate_file" });
    }
    documentId = created.documentId;
    versionId = created.versionId;
  } catch {
    redirectWith(DOCUMENTS, { error: "upload" });
  }

  if (typeParsed.data === "resume" || typeParsed.data === "resume_variant") {
    await supabase.from("resumes").upsert({ document_id: documentId, user_id: user.id }, { onConflict: "document_id" });
  }

  await runVersionJobs({
    supabase,
    actor,
    userId: user.id,
    profileDisplayName: profile.display_name,
    documentId,
    versionId,
    label,
    buffer: upload.buffer,
    mimeType: upload.mimeType,
  });

  revalidatePath("/app");
  revalidatePath(DOCUMENTS);
  revalidatePath("/app/memory");
  redirectWith(DOCUMENTS, { notice: upload.isText ? "extracted" : "binary_stored" });
}

export async function uploadDocumentVersion(formData: FormData) {
  const { user, profile, supabase, actor } = await requireWorkspace();
  const documentId = String(formData.get("documentId") ?? "");
  const file = formData.get("file");
  const setAsCurrent = String(formData.get("setAsCurrent") ?? "true") !== "false";

  if (!documentId || !(file instanceof File)) {
    redirectWith(DOCUMENTS, { error: "required" });
  }

  let upload;
  try {
    upload = await readValidatedUpload(file);
  } catch (error) {
    redirectWith(documentPath(documentId), { error: mapUploadError(error) });
  }

  const { data: document } = await supabase
    .from("documents")
    .select("id, label")
    .eq("id", documentId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!document) redirectWith(DOCUMENTS, { error: "not_found" });

  let versionId: string;
  try {
    const created = await addDocumentVersion({
      supabase,
      actor,
      userId: user.id,
      documentId,
      upload,
      setAsCurrent,
    });
    if (created.duplicate) {
      redirectWith(documentPath(documentId), { notice: "duplicate_file" });
    }
    versionId = created.versionId;
  } catch {
    redirectWith(documentPath(documentId), { error: "upload" });
  }

  await runVersionJobs({
    supabase,
    actor,
    userId: user.id,
    profileDisplayName: profile.display_name,
    documentId,
    versionId,
    label: document.label,
    buffer: upload.buffer,
    mimeType: upload.mimeType,
  });

  revalidatePath(DOCUMENTS);
  revalidatePath(documentPath(documentId));
  revalidatePath("/app/memory");
  redirectWith(documentPath(documentId), { notice: upload.isText ? "extracted" : "binary_stored" });
}

export async function setCurrentVersion(formData: FormData) {
  const { supabase, actor } = await requireWorkspace();
  const documentId = String(formData.get("documentId") ?? "");
  const versionId = String(formData.get("versionId") ?? "");
  if (!documentId || !versionId) redirectWith(DOCUMENTS, { error: "required" });

  try {
    await setCurrentDocumentVersion(supabase, actor, documentId, versionId);
  } catch {
    redirectWith(documentPath(documentId), { error: "save" });
  }

  revalidatePath(DOCUMENTS);
  revalidatePath(documentPath(documentId));
  redirectWith(documentPath(documentId), { notice: "version_selected" });
}

export async function downloadDocumentVersion(formData: FormData) {
  const { supabase, actor } = await requireWorkspace();
  const versionId = String(formData.get("versionId") ?? "");
  if (!versionId) redirectWith(DOCUMENTS, { error: "required" });

  try {
    const version = await assertOwnedVersion(supabase, actor, versionId);
    const signedUrl = await createDocumentReadUrl(supabase, actor, version.storage_path, 120);
    redirect(signedUrl);
  } catch (error) {
    logError("documents.download_failed", { versionId, error: String(error) });
    redirectWith(DOCUMENTS, { error: "not_found" });
  }
}
