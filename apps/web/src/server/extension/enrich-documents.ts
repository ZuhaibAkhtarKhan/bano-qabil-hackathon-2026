import type { FieldAttachment, FieldMapping } from "@1apply/form-engine";
import type { SupabaseClient } from "@supabase/supabase-js";

type DocRow = {
  id: string;
  type: string;
  label: string;
  current_version_id: string | null;
  document_versions:
    | Array<{
        id: string;
        original_filename: string | null;
        mime_type: string;
        byte_size: number;
        status: string;
      }>
    | null;
};

function pathForType(type: string): string {
  if (type === "resume" || type === "resume_variant") return "Documents → Resume";
  if (type === "cover_letter") return "Documents → Cover letter";
  if (type === "transcript") return "Documents → Transcript";
  return "Documents → Supporting";
}

function asOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function versionsOf(doc: DocRow) {
  const versions = Array.isArray(doc.document_versions) ? doc.document_versions : [];
  return versions.filter((item) => item.status !== "failed");
}

function toAttachment(doc: DocRow, versionId?: string | null): FieldAttachment | null {
  const versions = versionsOf(doc);
  const version = versions.find((item) => item.id === versionId) ?? versions.find((item) => item.id === doc.current_version_id) ?? versions[0];
  if (!version) return null;
  return {
    documentId: doc.id,
    versionId: version.id,
    filename: version.original_filename || `${doc.label}.pdf`,
    mimeType: version.mime_type || "application/pdf",
    byteSize: version.byte_size ?? 0,
  };
}

function docsForPath(docs: DocRow[], path: string): DocRow[] {
  if (path === "Documents → Resume") {
    return docs.filter((doc) => doc.type === "resume" || doc.type === "resume_variant");
  }
  if (path === "Documents → Cover letter") {
    return docs.filter((doc) => doc.type === "cover_letter");
  }
  if (path === "Documents → Transcript") {
    return docs.filter((doc) => doc.type === "transcript");
  }
  if (path === "Documents → Supporting") {
    return docs;
  }
  return docs.filter((doc) => pathForType(doc.type) === path);
}

/** Attach vault document versions to file-input mappings and expose them as chip options. */
export async function enrichDocumentAttachments(
  supabase: SupabaseClient,
  userId: string,
  mappings: FieldMapping[],
): Promise<FieldMapping[]> {
  if (!mappings.some((item) => item.fieldType === "file")) return mappings;

  const { data } = await supabase
    .from("documents")
    .select(
      "id, type, label, current_version_id, document_versions!document_id ( id, original_filename, mime_type, byte_size, status )",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const docs = ((data ?? []) as DocRow[]).map((doc) => ({
    ...doc,
    document_versions: Array.isArray(doc.document_versions)
      ? doc.document_versions
      : doc.document_versions
        ? [doc.document_versions]
        : [],
  }));

  return mappings.map((mapping) => {
    if (mapping.fieldType !== "file") return mapping;

    const matched = docsForPath(docs, mapping.memoryPath);
    const pool = matched.length ? matched : docs;
    const options = pool.flatMap((doc) => {
      const attachment = toAttachment(doc, doc.current_version_id);
      if (!attachment) return [];
      return [
        {
          value: attachment.versionId,
          label: `${doc.label} · ${attachment.filename}`,
          source: pathForType(doc.type),
        },
      ];
    });

    const primaryDoc = pool[0] ?? null;
    const attachment = primaryDoc ? toAttachment(primaryDoc, primaryDoc.current_version_id) : null;

    return {
      ...mapping,
      proposedValue: attachment?.versionId ?? mapping.proposedValue,
      options: options.length ? options : mapping.options,
      source: attachment ? pathForType(primaryDoc!.type) : mapping.source,
      excludedByDefault: !attachment,
      showChip: options.length > 1,
      attachment,
      reason: attachment
        ? `Will attach “${attachment.filename}” from your document vault.`
        : "File field detected, but no document is available in your vault.",
    };
  });
}

export function asDocumentRow(value: unknown): DocRow | null {
  return asOne(value as DocRow | DocRow[] | null);
}
