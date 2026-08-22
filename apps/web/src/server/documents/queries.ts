import { requireWorkspace } from "@/server/auth/require-workspace";
import type { DocumentListRow } from "@/server/types";

export async function loadDocumentDetail(documentId: string) {
  const { user, supabase } = await requireWorkspace();

  const { data: document } = await supabase
    .from("documents")
    .select(
      "id, type, label, current_version_id, created_at, updated_at, document_versions!document_id ( id, version_label, mime_type, byte_size, status, original_filename, source, storage_path, created_at )",
    )
    .eq("id", documentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!document) return null;

  const { data: chunks } = document.current_version_id
    ? await supabase
        .from("document_chunks")
        .select("chunk_index, content")
        .eq("document_version_id", document.current_version_id)
        .order("chunk_index", { ascending: true })
        .limit(6)
    : { data: [] as Array<{ chunk_index: number; content: string }> };

  const { data: attachedApplications } = await supabase
    .from("application_documents")
    .select("application_id, document_version_id, applications ( id, status, opportunities ( title, organization ) )")
    .eq("document_id", documentId);

  const { data: snapshots } = await supabase
    .from("submission_snapshots")
    .select("id, submitted_at, document_manifest")
    .eq("user_id", user.id)
    .order("submitted_at", { ascending: false });

  const snapshotUses = (snapshots ?? [])
    .flatMap((snapshot) => {
      const manifest = (snapshot.document_manifest ?? []) as Array<{
        documentId: string;
        documentVersionId: string;
      }>;
      return manifest
        .filter((entry) => entry.documentId === documentId)
        .map((entry) => ({
          snapshotId: snapshot.id as string,
          submittedAt: snapshot.submitted_at as string,
          documentVersionId: entry.documentVersionId,
        }));
    })
    .slice(0, 12);

  return {
    document: document as DocumentListRow,
    attachedApplications: attachedApplications ?? [],
    snapshotUses,
    extractedPreview: (chunks ?? [])
      .map((chunk) => String(chunk.content ?? ""))
      .join("\n\n")
      .slice(0, 4000),
  };
}
