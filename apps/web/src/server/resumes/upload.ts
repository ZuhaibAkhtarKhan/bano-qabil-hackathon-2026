import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveResumeCategory, type ResolvedResumeCategory } from "@1apply/domain";

import type { Actor } from "@/auth/actor";
import { extractDocumentText } from "@/lib/documents/extract-text";
import { type readValidatedUpload } from "@/lib/documents/upload-security";
import { autoAttachKitAcrossOpenApplications } from "@/server/applications/attach-kit";
import { ensureApplicationResumeSelection } from "@/server/intelligence/auto-resume";
import { recordAuditEvent } from "@/server/audit";
import {
  addDocumentVersion,
  createDocumentWithVersion,
} from "@/server/documents/service";
import { scheduleDocumentVersionProcessing } from "@/server/documents/schedule-processing";

type UploadPayload = Awaited<ReturnType<typeof readValidatedUpload>>;

export function categoryFromFormData(formData: FormData): ResolvedResumeCategory | null {
  return resolveResumeCategory({
    preset: String(formData.get("resumeCategory") ?? ""),
    otherLabel: String(formData.get("resumeCategoryOther") ?? ""),
  });
}

/**
 * Single resume ingest path for onboarding, memory, and documents.
 * Same category → new time-based version on the same document.
 * Category is remembrance-only; matching still scores every resume.
 */
export async function ingestCategorizedResume(input: {
  supabase: SupabaseClient;
  actor: Actor;
  userId: string;
  profileDisplayName: string | null;
  upload: UploadPayload;
  category: ResolvedResumeCategory;
  source: "memory" | "onboarding" | "documents";
  fillKit?: boolean;
}): Promise<{
  documentId: string;
  versionId: string;
  versionLabel: string;
  duplicate: boolean;
  isNewCategory: boolean;
  textExtracted: boolean;
  kitFilled: boolean;
  remainingBlanks: number;
}> {
  const { data: existingResume } = await input.supabase
    .from("resumes")
    .select("document_id")
    .eq("user_id", input.userId)
    .eq("category_key", input.category.key)
    .maybeSingle();

  let documentId: string;
  let versionId: string;
  let versionLabel = "v1";
  let duplicate = false;
  const isNewCategory = !existingResume?.document_id;

  if (existingResume?.document_id) {
    documentId = String(existingResume.document_id);
    const added = await addDocumentVersion({
      supabase: input.supabase,
      actor: input.actor,
      userId: input.userId,
      documentId,
      upload: input.upload,
      source: input.source,
      setAsCurrent: true,
    });
    versionId = added.versionId;
    versionLabel = added.versionLabel;
    duplicate = added.duplicate;

    await input.supabase
      .from("documents")
      .update({ label: input.category.label, type: "resume" })
      .eq("id", documentId)
      .eq("user_id", input.userId);

    await input.supabase.from("resumes").upsert(
      {
        document_id: documentId,
        user_id: input.userId,
        category_key: input.category.key,
        category_label: input.category.label,
        target_role: input.category.label,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "document_id" },
    );
  } else {
    const created = await createDocumentWithVersion({
      supabase: input.supabase,
      actor: input.actor,
      userId: input.userId,
      type: "resume",
      label: input.category.label,
      upload: input.upload,
      source: input.source,
      setAsCurrent: true,
    });
    documentId = created.documentId;
    versionId = created.versionId;
    duplicate = created.duplicate;
    versionLabel = "v1";

    await input.supabase.from("resumes").upsert(
      {
        document_id: documentId,
        user_id: input.userId,
        category_key: input.category.key,
        category_label: input.category.label,
        target_role: input.category.label,
      },
      { onConflict: "document_id" },
    );
  }

  if (duplicate) {
    return {
      documentId,
      versionId,
      versionLabel,
      duplicate: true,
      isNewCategory,
      textExtracted: false,
      kitFilled: false,
      remainingBlanks: 0,
    };
  }

  const processResult = {
    textExtracted: false,
    kitFilled: false,
    remainingBlanks: 0,
  };

  await recordAuditEvent(input.supabase, "document.uploaded", {
    documentId,
    versionId,
    source: input.source,
    resumeCategory: input.category.key,
    versionLabel,
  });

  const fillKit = input.fillKit !== false;
  scheduleDocumentVersionProcessing({
    supabase: input.supabase,
    actor: input.actor,
    userId: input.userId,
    documentId,
    versionId,
    documentLabel: input.category.label,
    profileDisplayName: input.profileDisplayName,
    fillKit,
    postProcess: async () => {
      const CLOSED = new Set(["submitted", "rejected", "withdrawn", "archived", "offer", "accepted"]);
      const { data: openApps } = await input.supabase
        .from("applications")
        .select("id, status")
        .eq("user_id", input.userId)
        .limit(20);

      for (const app of (openApps ?? []).filter((row) => !CLOSED.has(String(row.status)))) {
        try {
          await ensureApplicationResumeSelection(input.supabase, input.actor, String(app.id), {
            autoAttach: true,
            notifyOnAiPick: true,
            forceRefresh: true,
          });
        } catch {
          // Best-effort — upload already succeeded.
        }
      }
    },
  });

  if (!fillKit) {
    await autoAttachKitAcrossOpenApplications(input.supabase, input.actor);
  }

  return {
    documentId,
    versionId,
    versionLabel,
    duplicate: false,
    isNewCategory,
    ...processResult,
  };
}

export async function noticeForResumeUpload(upload: UploadPayload) {
  return (await extractDocumentText(upload.buffer, upload.mimeType)) ? "extracted" : "binary_stored";
}
