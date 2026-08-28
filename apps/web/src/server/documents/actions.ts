"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { documentTypeSchema } from "@1apply/contracts";

import { createDocumentReadUrl } from "@/infra/storage/documents";
import { logError } from "@/lib/log";
import { parseUseInKit, uploadQueuedNotice } from "@/lib/document-upload-options";
import { readValidatedUpload, UploadValidationError } from "@/lib/documents/upload-security";
import { requireWorkspace } from "@/server/auth/require-workspace";
import {
  addDocumentVersion,
  assertOwnedVersion,
  createDocumentWithVersion,
  deleteOwnedDocument,
  deleteOwnedDocumentVersion,
  setCurrentDocumentVersion,
} from "@/server/documents/service";
import { scheduleDocumentVersionProcessing } from "@/server/documents/schedule-processing";
import { redirectWith } from "@/server/http/flash";
import { rethrowNavigationError } from "@/server/http/navigation-errors";
import { recordAuditEvent } from "@/server/audit";
import { autoAttachKitAcrossOpenApplications } from "@/server/applications/attach-kit";
import { categoryFromFormData, ingestCategorizedResume } from "@/server/resumes/upload";

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

export async function uploadDocument(formData: FormData) {
  const { user, profile, supabase, actor } = await requireWorkspace();
  const file = formData.get("file");
  const label = String(formData.get("label") ?? "").trim();
  const typeParsed = documentTypeSchema.safeParse(String(formData.get("type") ?? "other"));
  const useInKit = parseUseInKit(formData);

  if (!(file instanceof File) || !typeParsed.success) {
    redirectWith(DOCUMENTS, { error: "required" });
  }

  let upload;
  try {
    upload = await readValidatedUpload(file);
  } catch (error) {
    redirectWith(DOCUMENTS, { error: mapUploadError(error) });
  }

  if (typeParsed.data === "resume" || typeParsed.data === "resume_variant") {
    const category = categoryFromFormData(formData);
    if (!category) redirectWith(DOCUMENTS, { error: "required" });
    let result;
    try {
      result = await ingestCategorizedResume({
        supabase,
        actor,
        userId: user.id,
        profileDisplayName: profile.display_name,
        upload,
        category,
        source: "documents",
        fillKit: useInKit,
      });
    } catch (error) {
      rethrowNavigationError(error);
      redirectWith(DOCUMENTS, { error: "upload" });
    }
    if (result.duplicate) redirectWith(DOCUMENTS, { notice: "duplicate_file" });
    revalidatePath("/app");
    revalidatePath(DOCUMENTS);
    revalidatePath("/app/memory");
    revalidatePath("/app/resumes");
    redirectWith(DOCUMENTS, { notice: uploadQueuedNotice(useInKit) });
  }

  if (!label) {
    redirectWith(DOCUMENTS, { error: "required" });
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
  } catch (error) {
    rethrowNavigationError(error);
    redirectWith(DOCUMENTS, { error: "upload" });
  }

  await recordAuditEvent(supabase, "document.uploaded", { documentId, versionId });

  scheduleDocumentVersionProcessing({
    supabase,
    actor,
    userId: user.id,
    documentId,
    versionId,
    documentLabel: label,
    profileDisplayName: profile.display_name,
    fillKit: useInKit,
  });

  if (!useInKit) {
    await autoAttachKitAcrossOpenApplications(supabase, actor);
  }

  revalidatePath("/app");
  revalidatePath(DOCUMENTS);
  revalidatePath("/app/memory");
  redirectWith(DOCUMENTS, { notice: uploadQueuedNotice(useInKit) });
}

export async function uploadDocumentVersion(formData: FormData) {
  const { user, profile, supabase, actor } = await requireWorkspace();
  const documentId = String(formData.get("documentId") ?? "");
  const file = formData.get("file");
  const setAsCurrent = String(formData.get("setAsCurrent") ?? "true") !== "false";
  const useInKit = parseUseInKit(formData);

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
  } catch (error) {
    rethrowNavigationError(error);
    redirectWith(documentPath(documentId), { error: "upload" });
  }

  scheduleDocumentVersionProcessing({
    supabase,
    actor,
    userId: user.id,
    documentId,
    versionId,
    documentLabel: document.label,
    profileDisplayName: profile.display_name,
    fillKit: useInKit,
  });

  revalidatePath(DOCUMENTS);
  revalidatePath(documentPath(documentId));
  revalidatePath("/app/memory");
  redirectWith(documentPath(documentId), { notice: uploadQueuedNotice(useInKit) });
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

export async function deleteDocument(formData: FormData) {
  const { supabase, actor } = await requireWorkspace();
  const documentId = String(formData.get("documentId") ?? "").trim();
  const returnToRaw = String(formData.get("returnTo") ?? DOCUMENTS).trim();
  const returnTo =
    returnToRaw.startsWith("/app/documents") || returnToRaw.startsWith("/app/resumes") || returnToRaw.startsWith("/app/memory")
      ? returnToRaw
      : DOCUMENTS;

  if (!documentId) redirectWith(returnTo, { error: "required" });

  try {
    await deleteOwnedDocument(supabase, actor, documentId);
    await recordAuditEvent(supabase, "document.deleted", { documentId });
  } catch (error) {
    logError("documents.delete_failed", { documentId, error: String(error) });
    redirectWith(returnTo, { error: "save" });
  }

  revalidatePath("/app");
  revalidatePath(DOCUMENTS);
  revalidatePath("/app/resumes");
  revalidatePath("/app/memory");
  revalidatePath("/app/applications");
  revalidatePath("/app/needs-you");
  redirectWith(returnTo, { notice: "document_deleted" });
}

export async function deleteDocumentVersion(formData: FormData) {
  const { supabase, actor } = await requireWorkspace();
  const versionId = String(formData.get("versionId") ?? "").trim();
  const returnToRaw = String(formData.get("returnTo") ?? DOCUMENTS).trim();
  const returnTo =
    returnToRaw.startsWith("/app/documents") || returnToRaw.startsWith("/app/resumes") || returnToRaw.startsWith("/app/memory")
      ? returnToRaw
      : DOCUMENTS;

  if (!versionId) redirectWith(returnTo, { error: "required" });

  let documentId = "";
  let documentDeleted = false;
  try {
    const result = await deleteOwnedDocumentVersion(supabase, actor, versionId);
    documentId = result.documentId;
    documentDeleted = result.documentDeleted;
    await recordAuditEvent(supabase, documentDeleted ? "document.deleted" : "document.version_deleted", {
      documentId,
      versionId,
    });
  } catch (error) {
    logError("documents.version_delete_failed", { versionId, error: String(error) });
    redirectWith(returnTo, { error: "save" });
  }

  revalidatePath("/app");
  revalidatePath(DOCUMENTS);
  revalidatePath("/app/resumes");
  revalidatePath("/app/memory");
  revalidatePath("/app/applications");
  revalidatePath("/app/needs-you");
  if (documentId) revalidatePath(documentPath(documentId));

  if (documentDeleted) {
    const listReturn =
      returnTo.startsWith("/app/resumes") || returnTo.startsWith("/app/memory") || returnTo === DOCUMENTS
        ? returnTo
        : DOCUMENTS;
    redirectWith(listReturn, { notice: "document_deleted" });
  }

  redirectWith(returnTo, { notice: "version_deleted" });
}

export async function downloadDocumentVersion(formData: FormData) {
  const { supabase, actor } = await requireWorkspace();
  const versionId = String(formData.get("versionId") ?? "");
  if (!versionId) redirectWith(DOCUMENTS, { error: "required" });

  try {
    const version = await assertOwnedVersion(supabase, actor, versionId);
    const signedUrl = await createDocumentReadUrl(supabase, actor, version.storage_path, 120);
    await recordAuditEvent(supabase, "document.downloaded", { versionId });
    redirect(signedUrl);
  } catch (error) {
    logError("documents.download_failed", { versionId, error: String(error) });
    redirectWith(DOCUMENTS, { error: "not_found" });
  }
}
