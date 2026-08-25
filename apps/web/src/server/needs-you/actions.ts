"use server";

import { revalidatePath } from "next/cache";

import { memoryFactKey } from "@1apply/domain";

import { documentStoragePath } from "@/infra/storage/documents";
import { loadAppConfig } from "@/config/env";
import { runOwnedJob } from "@/infra/jobs/runner";
import { APPLICATION_LIFECYCLE_ACTIONS } from "@/lib/application-lifecycle";
import { normalizeApplicationStatus } from "@/lib/application-workflow";
import { logError } from "@/lib/log";
import type { ProfileMemoryField } from "@/lib/needs-you";
import { readValidatedUpload, UploadValidationError } from "@/lib/documents/upload-security";
import { generateAnswer } from "@/server/answers/generate";
import { recordAuditEvent } from "@/server/audit";
import { requireWorkspace } from "@/server/auth/require-workspace";
import { processDocumentVersion } from "@/server/documents/service";
import { redirectWith } from "@/server/http/flash";
import { evaluateApplicationIntelligence } from "@/server/intelligence/evaluate";
import { syncMemoryConflicts } from "@/server/memory/persist-extraction";
import { emitDomainEvent } from "@/server/notifications/service";
import { recordApplicationEvent } from "@/services/platform";

const NEEDS_YOU = "/app/needs-you";

async function notify(
  supabase: Awaited<ReturnType<typeof requireWorkspace>>["supabase"],
  actor: { userId: string },
  applicationId: string,
  title: string,
  body: string,
  name: Parameters<typeof emitDomainEvent>[1]["name"],
) {
  await emitDomainEvent(
    supabase,
    {
      name,
      userId: actor.userId,
      applicationId,
      subjectId: `${applicationId}:${name}`,
      title,
      body,
    },
    { recordTimeline: false },
  );
}

function revalidateNeedsYou(applicationId?: string) {
  revalidatePath("/app");
  revalidatePath(NEEDS_YOU);
  revalidatePath("/app/memory");
  revalidatePath("/app/applications");
  if (applicationId) {
    revalidatePath(`/app/applications/${applicationId}`);
  }
}

function profileColumn(field: ProfileMemoryField | null | undefined): string | null {
  if (!field || field === "date_of_birth") return null;
  return field;
}

async function storeMemoryValue(input: {
  supabase: Awaited<ReturnType<typeof requireWorkspace>>["supabase"];
  userId: string;
  label: string;
  value: string;
  profileField?: ProfileMemoryField | null;
}) {
  const value = input.value.trim();
  if (!value) return;

  const field = input.profileField ?? "supporting_detail";
  const factKey = memoryFactKey({
    category: "personal",
    title: input.label.slice(0, 80) || field,
    field: field,
  });

  await input.supabase.from("profile_facts").insert({
    user_id: input.userId,
    category: "personal",
    fact_type: field,
    fact_key: factKey,
    value: { text: value, label: input.label },
    source: "needs_you",
    extraction_status: "manual",
    verification_status: "verified",
    excerpt: input.label.slice(0, 240),
  });

  const column = profileColumn(input.profileField);
  if (column) {
    await input.supabase
      .from("profiles")
      .update({ [column]: value })
      .eq("id", input.userId);
  }

  await syncMemoryConflicts(input.supabase, input.userId);
}

async function continueApplicationInBackground(input: {
  supabase: Awaited<ReturnType<typeof requireWorkspace>>["supabase"];
  actor: Awaited<ReturnType<typeof requireWorkspace>>["actor"];
  userId: string;
  applicationId: string;
  questionIds?: string[];
}) {
  const { data: application } = await input.supabase
    .from("applications")
    .select("id, opportunity_id, status")
    .eq("id", input.applicationId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (!application) return;

  const normalized = normalizeApplicationStatus(application.status as Parameters<typeof normalizeApplicationStatus>[0]);
  await input.supabase
    .from("applications")
    .update({
      status: normalized === "saved" || normalized === "review_required" ? "analyzing" : application.status,
      next_action: APPLICATION_LIFECYCLE_ACTIONS.STOPPED_CONTINUING,
    })
    .eq("id", input.applicationId);

  await recordApplicationEvent(input.supabase, input.actor, input.applicationId, "needs_you.resolved", {
    questionIds: input.questionIds ?? [],
  });

  try {
    await runOwnedJob(
      input.supabase,
      { actor: input.actor, type: "eligibility_evaluate", inputRef: input.applicationId },
      async () => {
        const { eligibility } = await evaluateApplicationIntelligence(
          input.supabase,
          input.actor,
          input.applicationId,
          application.opportunity_id,
        );

        await input.supabase
          .from("review_items")
          .delete()
          .eq("application_id", input.applicationId)
          .eq("resolved", false);

        const review = eligibility
          .filter(
            (item) =>
              item.state === "unclear" ||
              item.state === "not_met" ||
              item.state === "not_evaluated" ||
              item.state === "partial",
          )
          .map((item) => ({
            user_id: input.userId,
            application_id: input.applicationId,
            kind: "eligibility",
            prompt: item.explanation,
            resolved: false,
          }));

        if (review.length > 0) {
          await input.supabase.from("review_items").insert(review);
        }

        for (const questionId of input.questionIds ?? []) {
          try {
            await generateAnswer(input.supabase, input.actor, {
              applicationId: input.applicationId,
              questionId,
              intent: "draft",
              tone: "formal",
            });
          } catch (err) {
            logError("needs_you.regenerate_failed", { err, questionId, applicationId: input.applicationId });
          }
        }

        const hardMiss = eligibility.some((item) => item.hard && item.state === "not_met");
        await input.supabase
          .from("applications")
          .update({
            next_action: hardMiss
              ? "Hard eligibility is not satisfied — review before applying"
              : review.length > 0
                ? APPLICATION_LIFECYCLE_ACTIONS.NEEDS_YOU
                : "Review generated answers and prepare submission",
            status: review.length > 0 ? "review_required" : application.status,
          })
          .eq("id", input.applicationId);

        await notify(
          input.supabase,
          input.actor,
          input.applicationId,
          "Application continued",
          "Your new Application Memory was applied. Eligibility and drafts were refreshed in the background.",
          "intelligence.updated",
        );
      },
    );
  } catch (err) {
    logError("needs_you.continue_failed", { err, applicationId: input.applicationId });
    await input.supabase
      .from("applications")
      .update({
        next_action: "Could not finish background refresh — open the application and run Analyze again",
      })
      .eq("id", input.applicationId);
  }
}

export async function resolveNeedsYouMemory(formData: FormData) {
  const { user, supabase, actor } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const value = String(formData.get("value") ?? "").trim();
  const label = String(formData.get("label") ?? "Application fact").trim();
  const profileField = (String(formData.get("profileField") ?? "").trim() || null) as ProfileMemoryField | null;
  const reviewItemId = String(formData.get("reviewItemId") ?? "").trim() || null;
  const questionId = String(formData.get("questionId") ?? "").trim() || null;
  const mappingId = String(formData.get("mappingId") ?? "").trim() || null;

  if (!applicationId || !value) {
    redirectWith(NEEDS_YOU, { error: "required" });
  }

  await storeMemoryValue({
    supabase,
    userId: user.id,
    label,
    value,
    profileField,
  });

  if (reviewItemId) {
    await supabase.from("review_items").update({ resolved: true }).eq("id", reviewItemId).eq("user_id", user.id);
  }

  if (mappingId) {
    await supabase
      .from("field_mappings")
      .update({
        value: value.slice(0, 4000),
        source: "Application Memory (Needs You)",
        confidence: 1,
        excluded_by_default: false,
      })
      .eq("id", mappingId)
      .eq("user_id", user.id);
  }

  await continueApplicationInBackground({
    supabase,
    actor,
    userId: user.id,
    applicationId,
    questionIds: questionId ? [questionId] : [],
  });

  revalidateNeedsYou(applicationId);
  redirectWith(NEEDS_YOU, { notice: "continued" });
}

export async function resolveNeedsYouAnswer(formData: FormData) {
  const { user, supabase, actor } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const questionId = String(formData.get("questionId") ?? "");
  const answerId = String(formData.get("answerId") ?? "").trim() || null;
  const text = String(formData.get("value") ?? "").trim();

  if (!applicationId || !questionId || !text) {
    redirectWith(NEEDS_YOU, { error: "required" });
  }

  // Persist the answer content into memory so future applications can reuse it.
  const { data: question } = await supabase
    .from("opportunity_questions")
    .select("prompt")
    .eq("id", questionId)
    .maybeSingle();

  await storeMemoryValue({
    supabase,
    userId: user.id,
    label: String(question?.prompt ?? "Application answer"),
    value: text,
    profileField: null,
  });

  if (answerId) {
    await supabase
      .from("application_answers")
      .update({
        user_edited_text: text,
        approved_text: text,
        state: "approved",
        missing_facts: [],
        warnings: [],
      })
      .eq("id", answerId)
      .eq("user_id", user.id);
  } else {
    await supabase.from("application_answers").insert({
      user_id: user.id,
      application_id: applicationId,
      question_id: questionId,
      user_edited_text: text,
      approved_text: text,
      state: "approved",
      missing_facts: [],
      warnings: [],
      evidence_ids: [],
      claim_flags: [],
      grounding_score: 0,
      generation_count: 0,
      model: null,
    });
  }

  await continueApplicationInBackground({
    supabase,
    actor,
    userId: user.id,
    applicationId,
  });

  revalidateNeedsYou(applicationId);
  redirectWith(NEEDS_YOU, { notice: "continued" });
}

export async function resolveNeedsYouDocument(formData: FormData) {
  const { user, profile, supabase, actor } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const documentId = String(formData.get("documentId") ?? "").trim();
  const requiredLabel = String(formData.get("requiredLabel") ?? "").trim() || "Supporting document";
  const file = formData.get("file");

  if (!applicationId) {
    redirectWith(NEEDS_YOU, { error: "required" });
  }

  let resolvedDocumentId = documentId;
  let versionId: string | null = null;

  if (file instanceof File && file.size > 0) {
    let upload;
    try {
      upload = await readValidatedUpload(file);
    } catch (error) {
      redirectWith(NEEDS_YOU, {
        error: error instanceof UploadValidationError && error.code === "required" ? "required" : "upload",
      });
    }

    const newDocumentId = crypto.randomUUID();
    const newVersionId = crypto.randomUUID();
    const storagePath = documentStoragePath({
      actor,
      documentId: newDocumentId,
      versionId: newVersionId,
      type: "other",
      fileName: upload.sanitizedFilename,
    });
    const bucket = loadAppConfig().storageBucket;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(storagePath, upload.buffer, { contentType: upload.mimeType, upsert: false });
    if (uploadError) redirectWith(NEEDS_YOU, { error: "upload" });

    await supabase.from("documents").insert({
      id: newDocumentId,
      user_id: user.id,
      type: "other",
      label: requiredLabel,
    });
    await supabase.from("document_versions").insert({
      id: newVersionId,
      document_id: newDocumentId,
      user_id: user.id,
      version_label: "v1",
      storage_path: storagePath,
      file_hash: upload.fileHash,
      mime_type: upload.mimeType,
      byte_size: upload.buffer.length,
      status: "processing",
    });
    await supabase.from("documents").update({ current_version_id: newVersionId }).eq("id", newDocumentId);

    await recordAuditEvent(supabase, "document.uploaded", {
      documentId: newDocumentId,
      versionId: newVersionId,
      source: "needs_you",
    });

    await runOwnedJob(supabase, { actor, type: "document_extract", inputRef: newVersionId }, async () => {
      await processDocumentVersion({
        supabase,
        userId: user.id,
        documentId: newDocumentId,
        versionId: newVersionId,
        documentLabel: requiredLabel,
        profileDisplayName: profile.display_name,
        buffer: upload.buffer,
        mimeType: upload.mimeType,
      });
    });

    resolvedDocumentId = newDocumentId;
    versionId = newVersionId;
  } else if (documentId) {
    const { data: document } = await supabase
      .from("documents")
      .select("id, current_version_id")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!document?.current_version_id) {
      redirectWith(NEEDS_YOU, { error: "required" });
    }
    versionId = String(document.current_version_id);
  } else {
    redirectWith(NEEDS_YOU, { error: "required" });
  }

  await supabase
    .from("application_documents")
    .delete()
    .eq("application_id", applicationId)
    .eq("document_id", resolvedDocumentId);

  await supabase.from("application_documents").insert({
    user_id: user.id,
    application_id: applicationId,
    document_id: resolvedDocumentId,
    document_version_id: versionId,
  });

  await recordApplicationEvent(supabase, actor, applicationId, "document.attached", {
    documentId: resolvedDocumentId,
    versionId,
    source: "needs_you",
  });

  await continueApplicationInBackground({
    supabase,
    actor,
    userId: user.id,
    applicationId,
  });

  revalidateNeedsYou(applicationId);
  revalidatePath("/app/documents");
  redirectWith(NEEDS_YOU, { notice: "continued" });
}

export async function dismissNeedsYouReview(formData: FormData) {
  const { user, supabase, actor } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const reviewItemId = String(formData.get("reviewItemId") ?? "");
  if (!applicationId || !reviewItemId) {
    redirectWith(NEEDS_YOU, { error: "required" });
  }

  await supabase
    .from("review_items")
    .update({ resolved: true })
    .eq("id", reviewItemId)
    .eq("user_id", user.id);

  await continueApplicationInBackground({
    supabase,
    actor,
    userId: user.id,
    applicationId,
  });

  revalidateNeedsYou(applicationId);
  redirectWith(NEEDS_YOU, { notice: "continued" });
}
