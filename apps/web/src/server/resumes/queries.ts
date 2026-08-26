import { resumeCategoryDisplayLabel } from "@1apply/domain";

import type { DocumentListRow } from "@/server/types";
import { requireWorkspace } from "@/server/auth/require-workspace";

export type ResumeCategoryGroup = {
  categoryKey: string;
  categoryLabel: string;
  documentId: string;
  currentVersionLabel: string | null;
  versions: Array<{
    id: string;
    versionLabel: string;
    status: string;
    createdAt: string;
    fileName: string | null;
  }>;
};

export async function loadResumeCatalog(): Promise<ResumeCategoryGroup[]> {
  const { profile, supabase } = await requireWorkspace();
  const [{ data: resumeRows }, { data: documents }] = await Promise.all([
    supabase
      .from("resumes")
      .select("document_id, category_key, category_label, target_role, updated_at")
      .eq("user_id", profile.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("documents")
      .select(
        "id, type, label, current_version_id, created_at, document_versions!document_id ( id, version_label, mime_type, byte_size, status, original_filename, created_at )",
      )
      .eq("user_id", profile.id)
      .in("type", ["resume", "resume_variant"])
      .order("created_at", { ascending: false }),
  ]);

  const docs = (documents ?? []) as DocumentListRow[];
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const seen = new Set<string>();
  const groups: ResumeCategoryGroup[] = [];

  for (const row of resumeRows ?? []) {
    const documentId = String(row.document_id);
    const doc = byId.get(documentId);
    if (!doc) continue;
    seen.add(documentId);
    const versions = [...(Array.isArray(doc.document_versions) ? doc.document_versions : [])].sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)),
    );
    const current = versions.find((item) => item.id === doc.current_version_id) ?? versions[versions.length - 1] ?? null;
    const categoryKey = String(row.category_key ?? `legacy-${documentId.slice(0, 8)}`);
    groups.push({
      categoryKey,
      categoryLabel: resumeCategoryDisplayLabel(categoryKey, String(row.category_label ?? row.target_role ?? doc.label)),
      documentId,
      currentVersionLabel: current ? String(current.version_label) : null,
      versions: versions.map((item) => ({
        id: String(item.id),
        versionLabel: String(item.version_label),
        status: String(item.status),
        createdAt: String(item.created_at),
        fileName: item.original_filename ? String(item.original_filename) : null,
      })),
    });
  }

  for (const doc of docs) {
    if (seen.has(doc.id)) continue;
    const versions = [...(Array.isArray(doc.document_versions) ? doc.document_versions : [])].sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)),
    );
    const current = versions.find((item) => item.id === doc.current_version_id) ?? versions[versions.length - 1] ?? null;
    groups.push({
      categoryKey: `legacy-${doc.id.slice(0, 8)}`,
      categoryLabel: doc.label || "Uncategorized",
      documentId: doc.id,
      currentVersionLabel: current ? String(current.version_label) : null,
      versions: versions.map((item) => ({
        id: String(item.id),
        versionLabel: String(item.version_label),
        status: String(item.status),
        createdAt: String(item.created_at),
        fileName: item.original_filename ? String(item.original_filename) : null,
      })),
    });
  }

  return groups;
}
