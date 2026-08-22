import type { DocumentType } from "@1apply/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { loadAppConfig, STORAGE_PREFIX } from "@/config/env";
import { sanitizeFileName } from "@/lib/documents/upload-security";

export function documentStoragePath(input: {
  actor: Actor;
  documentId: string;
  versionId: string;
  type: DocumentType;
  fileName: string;
}): string {
  const prefix = STORAGE_PREFIX[input.type] ?? STORAGE_PREFIX.other;
  const safe = sanitizeFileName(input.fileName);
  return `${input.actor.userId}/${prefix}/${input.documentId}/${input.versionId}/${safe}`;
}

export async function createDocumentReadUrl(
  supabase: SupabaseClient,
  actor: Actor,
  storagePath: string,
  expiresIn = 60,
) {
  if (!storagePath.startsWith(`${actor.userId}/`)) {
    throw new Error("FORBIDDEN");
  }
  const bucket = loadAppConfig().storageBucket;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, expiresIn);
  if (error || !data) throw new Error("STORAGE_SIGN_FAILED");
  return data.signedUrl;
}
