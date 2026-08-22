import type { DocumentType } from "@1apply/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { loadAppConfig } from "@/config/env";
import {
  chunkDocumentText,
  extractDocumentText,
  type readValidatedUpload,
} from "@/lib/documents/upload-security";
import { nextVersionLabel } from "@/lib/documents/versioning";
import { logError } from "@/lib/log";
import { documentStoragePath } from "@/infra/storage/documents";
import { extractFromDocumentText } from "@/server/memory/extract-from-document";
import { indexDocumentVersionEmbeddings } from "@/services/embeddings";

type UploadPayload = Awaited<ReturnType<typeof readValidatedUpload>>;

export async function assertOwnedDocument(
  supabase: SupabaseClient,
  actor: Actor,
  documentId: string,
): Promise<{ id: string; type: DocumentType; label: string; current_version_id: string | null; user_id: string }> {
  const { data } = await supabase
    .from("documents")
    .select("id, type, label, current_version_id, user_id")
    .eq("id", documentId)
    .maybeSingle();
  if (!data || data.user_id !== actor.userId) {
    throw new Error("DOCUMENT_FORBIDDEN");
  }
  return data as { id: string; type: DocumentType; label: string; current_version_id: string | null; user_id: string };
}

export async function assertOwnedVersion(
  supabase: SupabaseClient,
  actor: Actor,
  versionId: string,
): Promise<{
  id: string;
  document_id: string;
  user_id: string;
  version_label: string;
  storage_path: string;
  mime_type: string;
  status: string;
}> {
  const { data } = await supabase
    .from("document_versions")
    .select("id, document_id, user_id, version_label, storage_path, mime_type, status")
    .eq("id", versionId)
    .maybeSingle();
  if (!data || data.user_id !== actor.userId) {
    throw new Error("DOCUMENT_FORBIDDEN");
  }
  return data as {
    id: string;
    document_id: string;
    user_id: string;
    version_label: string;
    storage_path: string;
    mime_type: string;
    status: string;
  };
}

export async function createDocumentWithVersion(input: {
  supabase: SupabaseClient;
  actor: Actor;
  userId: string;
  type: DocumentType;
  label: string;
  upload: UploadPayload;
  source?: string;
  setAsCurrent?: boolean;
}): Promise<{ documentId: string; versionId: string; duplicate: boolean }> {
  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const storagePath = documentStoragePath({
    actor: input.actor,
    documentId,
    versionId,
    type: input.type,
    fileName: input.upload.sanitizedFilename,
  });
  const bucket = loadAppConfig().storageBucket;

  const { error: uploadError } = await input.supabase.storage
    .from(bucket)
    .upload(storagePath, input.upload.buffer, { contentType: input.upload.mimeType, upsert: false });
  if (uploadError) throw new Error("STORAGE_UPLOAD_FAILED");

  const { error: documentError } = await input.supabase.from("documents").insert({
    id: documentId,
    user_id: input.userId,
    type: input.type,
    label: input.label,
  });
  if (documentError) {
    await input.supabase.storage.from(bucket).remove([storagePath]);
    throw new Error("DOCUMENT_INSERT_FAILED");
  }

  const { error: versionError } = await input.supabase.from("document_versions").insert({
    id: versionId,
    document_id: documentId,
    user_id: input.userId,
    version_label: "v1",
    storage_path: storagePath,
    file_hash: input.upload.fileHash,
    mime_type: input.upload.mimeType,
    byte_size: input.upload.buffer.length,
    original_filename: input.upload.originalFilename,
    source: input.source ?? "upload",
    status: "processing",
  });

  if (versionError) {
    await input.supabase.from("documents").delete().eq("id", documentId);
    await input.supabase.storage.from(bucket).remove([storagePath]);
    if (versionError.code === "23505") {
      return { documentId, versionId, duplicate: true };
    }
    throw new Error("VERSION_INSERT_FAILED");
  }

  if (input.setAsCurrent !== false) {
    await input.supabase.from("documents").update({ current_version_id: versionId }).eq("id", documentId);
  }

  return { documentId, versionId, duplicate: false };
}

export async function addDocumentVersion(input: {
  supabase: SupabaseClient;
  actor: Actor;
  userId: string;
  documentId: string;
  upload: UploadPayload;
  source?: string;
  setAsCurrent?: boolean;
}): Promise<{ versionId: string; versionLabel: string; duplicate: boolean }> {
  const document = await assertOwnedDocument(input.supabase, input.actor, input.documentId);
  const { data: existing } = await input.supabase
    .from("document_versions")
    .select("version_label")
    .eq("document_id", input.documentId)
    .order("created_at", { ascending: true });

  const versionLabel = nextVersionLabel((existing ?? []).map((row) => String(row.version_label)));
  const versionId = crypto.randomUUID();
  const storagePath = documentStoragePath({
    actor: input.actor,
    documentId: input.documentId,
    versionId,
    type: document.type,
    fileName: input.upload.sanitizedFilename,
  });
  const bucket = loadAppConfig().storageBucket;

  const { error: uploadError } = await input.supabase.storage
    .from(bucket)
    .upload(storagePath, input.upload.buffer, { contentType: input.upload.mimeType, upsert: false });
  if (uploadError) throw new Error("STORAGE_UPLOAD_FAILED");

  const { error: versionError } = await input.supabase.from("document_versions").insert({
    id: versionId,
    document_id: input.documentId,
    user_id: input.userId,
    version_label: versionLabel,
    storage_path: storagePath,
    file_hash: input.upload.fileHash,
    mime_type: input.upload.mimeType,
    byte_size: input.upload.buffer.length,
    original_filename: input.upload.originalFilename,
    source: input.source ?? "upload",
    status: "processing",
  });

  if (versionError) {
    await input.supabase.storage.from(bucket).remove([storagePath]);
    if (versionError.code === "23505") {
      return { versionId, versionLabel, duplicate: true };
    }
    throw new Error("VERSION_INSERT_FAILED");
  }

  if (input.setAsCurrent !== false) {
    await input.supabase
      .from("documents")
      .update({ current_version_id: versionId })
      .eq("id", input.documentId)
      .eq("user_id", input.userId);
  }

  return { versionId, versionLabel, duplicate: false };
}

export async function setCurrentDocumentVersion(
  supabase: SupabaseClient,
  actor: Actor,
  documentId: string,
  versionId: string,
): Promise<void> {
  await assertOwnedDocument(supabase, actor, documentId);
  const version = await assertOwnedVersion(supabase, actor, versionId);
  if (version.document_id !== documentId) {
    throw new Error("DOCUMENT_FORBIDDEN");
  }
  await supabase
    .from("documents")
    .update({ current_version_id: versionId })
    .eq("id", documentId)
    .eq("user_id", actor.userId);
}

export async function processDocumentVersion(input: {
  supabase: SupabaseClient;
  userId: string;
  documentId: string;
  versionId: string;
  documentLabel: string;
  profileDisplayName: string | null;
  buffer: Buffer;
  mimeType: string;
}): Promise<{ extracted: boolean; embedded: boolean; textExtracted: boolean }> {
  const extractedText = await extractDocumentText(input.buffer, input.mimeType);
  let extracted = false;
  let embedded = false;

  if (extractedText) {
    const chunks = chunkDocumentText(extractedText);
    if (chunks.length > 0) {
      await input.supabase.from("document_chunks").insert(
        chunks.map((content, index) => ({
          user_id: input.userId,
          document_version_id: input.versionId,
          chunk_index: index,
          content,
        })),
      );
    }

    const result = await extractFromDocumentText({
      supabase: input.supabase,
      userId: input.userId,
      documentId: input.documentId,
      versionId: input.versionId,
      documentLabel: input.documentLabel,
      extractedText,
      profileDisplayName: input.profileDisplayName,
    });
    extracted = result.extracted;
  }

  try {
    await indexDocumentVersionEmbeddings(input.supabase, input.userId, input.versionId);
    embedded = true;
  } catch {
    logError("documents.embed_failed", { versionId: input.versionId });
  }

  await input.supabase.from("document_versions").update({ status: "ready" }).eq("id", input.versionId);
  return { extracted, embedded, textExtracted: Boolean(extractedText) };
}
