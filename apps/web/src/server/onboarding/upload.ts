"use server";

import { revalidatePath } from "next/cache";

import { documentTypeSchema } from "@1apply/contracts";

import { parseUseInKit, uploadQueuedNotice } from "@/lib/document-upload-options";
import { readValidatedUpload, UploadValidationError } from "@/lib/documents/upload-security";
import { requireWorkspace } from "@/server/auth/require-workspace";
import { createDocumentWithVersion } from "@/server/documents/service";
import { scheduleDocumentVersionProcessing } from "@/server/documents/schedule-processing";
import { autoAttachKitAcrossOpenApplications } from "@/server/applications/attach-kit";
import { redirectWith } from "@/server/http/flash";
import { rethrowNavigationError } from "@/server/http/navigation-errors";
import { recordAuditEvent } from "@/server/audit";
import { categoryFromFormData, ingestCategorizedResume } from "@/server/resumes/upload";

const DOCUMENTS = "/app/onboarding/documents";

export async function uploadOnboardingResume(formData: FormData) {
  await uploadOnboardingKitDocument(formData);
}

export async function uploadOnboardingKitDocument(formData: FormData) {
  const { user, profile, supabase, actor } = await requireWorkspace();
  const file = formData.get("file");
  const label = String(formData.get("label") ?? "Document").trim() || "Document";
  const typeParsed = documentTypeSchema.safeParse(String(formData.get("type") ?? "resume"));

  const useInKit = parseUseInKit(formData);

  if (!(file instanceof File) || file.size === 0 || !typeParsed.success) {
    redirectWith(DOCUMENTS, { error: "required" });
  }

  let upload;
  try {
    upload = await readValidatedUpload(file);
  } catch (error) {
    redirectWith(DOCUMENTS, {
      error: error instanceof UploadValidationError && error.code === "required" ? "required" : "upload",
    });
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
        source: "onboarding",
        fillKit: useInKit,
      });
    } catch (error) {
      rethrowNavigationError(error);
      redirectWith(DOCUMENTS, { error: "upload" });
    }
    if (result.duplicate) redirectWith(DOCUMENTS, { notice: "duplicate_file" });
    revalidatePath("/app/onboarding");
    revalidatePath("/app/memory");
    revalidatePath("/app/documents");
    revalidatePath("/app/resumes");
    redirectWith(DOCUMENTS, { notice: uploadQueuedNotice(useInKit) });
    return;
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

  await recordAuditEvent(supabase, "document.uploaded", { documentId, versionId, source: "onboarding" });

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

  revalidatePath("/app/onboarding");
  revalidatePath("/app/memory");
  revalidatePath("/app/documents");
  redirectWith(DOCUMENTS, { notice: uploadQueuedNotice(useInKit) });
}
