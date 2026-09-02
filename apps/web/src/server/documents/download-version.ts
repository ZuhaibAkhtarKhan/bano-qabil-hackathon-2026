import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAppConfig } from "@/config/env";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export type DocumentVersionUpload = {
  versionId: string;
  documentId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
};

/** Load vault document bytes for server-side form upload (Playwright setInputFiles). */
export async function loadDocumentVersionUpload(input: {
  supabase: SupabaseClient;
  userId: string;
  versionId: string;
}): Promise<DocumentVersionUpload | null> {
  const { data: version } = await input.supabase
    .from("document_versions")
    .select("id, document_id, storage_path, mime_type, byte_size, original_filename, user_id")
    .eq("id", input.versionId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (!version?.storage_path) return null;
  if (!String(version.storage_path).startsWith(`${input.userId}/`)) return null;

  const bucket = loadAppConfig().storageBucket;
  const { data: blob, error } = await input.supabase.storage
    .from(bucket)
    .download(String(version.storage_path));
  if (error || !blob) return null;

  const buffer = Buffer.from(await blob.arrayBuffer());
  if (buffer.byteLength > MAX_UPLOAD_BYTES) return null;

  return {
    versionId: String(version.id),
    documentId: String(version.document_id),
    filename: String(version.original_filename || "document.pdf"),
    mimeType: String(version.mime_type || "application/pdf"),
    buffer,
  };
}
