"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { expandAffirmativeAuthorizationValue, isDeadlineInPast, memoryFactKey, parseDeadlineLocalInput } from "@1apply/domain";

import { documentStoragePath } from "@/infra/storage/documents";
import { loadAppConfig } from "@/config/env";
import { runOwnedJob } from "@/infra/jobs/runner";
import { APPLICATION_LIFECYCLE_ACTIONS } from "@/lib/application-lifecycle";
import { normalizeApplicationStatus } from "@/lib/application-workflow";
import { logError } from "@/lib/log";
import type { ProfileMemoryField } from "@/lib/needs-you";
import { isNeedsYouSystemNoise } from "@/lib/needs-you";
import { joinNeedsYouMultiValues } from "@/lib/needs-you-field-kinds";
import { readValidatedUpload, UploadValidationError, IMAGE_UPLOAD_MIME_TYPES } from "@/lib/documents/upload-security";
import { generateAnswer } from "@/server/answers/generate";
import { recordAuditEvent } from "@/server/audit";
import { requireWorkspace } from "@/server/auth/require-workspace";
import { scheduleDocumentVersionProcessing } from "@/server/documents/schedule-processing";
import { type ErrorCode, type FlashCode } from "@/server/http/flash";
import { loadNeedsYouQueue } from "@/server/needs-you/queries";
import { evaluateApplicationIntelligence } from "@/server/intelligence/evaluate";
import { syncMemoryConflicts } from "@/server/memory/persist-extraction";
import { scheduleRefreshOpenApplicationsFromKit } from "@/server/applications/refresh-from-kit";
import { applyValueToApplication } from "@/server/needs-you/apply-needs-you-value";
import {
  resolveEligibilityForConfirm,
  settleEligibilityFromApplicantAnswer,
} from "@/server/needs-you/confirm-eligibility";
import { emitDomainEvent } from "@/server/notifications/service";
import { recordApplicationEvent } from "@/services/platform";

const NEEDS_YOU = "/app/needs-you";

export type NeedsYouActionResult =
  | { ok: true; notice?: FlashCode }
  | { ok: false; error: ErrorCode };

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

  const isProfileField = Boolean(input.profileField);
  const category = isProfileField ? "personal" : "answers";
  const field = input.profileField ?? "saved_answer";
  const storedValue =
    field === "work_authorization"
      ? expandAffirmativeAuthorizationValue(value, input.label)
      : value;
  const factKey = memoryFactKey({
    category,
    title: input.label.slice(0, 80) || field,
    field,
  });

  await input.supabase.from("profile_facts").insert({
    user_id: input.userId,
    category,
    fact_type: field,
    fact_key: factKey,
    value: { text: storedValue, label: input.label },
    source: "needs_you",
    extraction_status: "manual",
    verification_status: "verified",
    excerpt: input.label.slice(0, 240),
  });

  const column = profileColumn(input.profileField);
  if (column) {
    await input.supabase
      .from("profiles")
      .update({ [column]: storedValue })
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
  /** Eligibility/review prompts the user already answered (do not re-queue). */
  satisfiedPrompts?: string[];
  scope?: "memory" | "application";
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
    scope: input.scope ?? "memory",
  });

  const satisfied = new Set(
    (input.satisfiedPrompts ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean),
  );

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
              item.requirementId !== "none" &&
              !isNeedsYouSystemNoise(String(item.explanation ?? "")) &&
              !isNeedsYouSystemNoise(String(item.requirementText ?? "")) &&
              (item.state === "unclear" ||
                item.state === "not_met" ||
                item.state === "not_evaluated" ||
                item.state === "partial"),
          )
          .filter((item) => !satisfied.has(String(item.explanation ?? "").trim().toLowerCase()))
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
          input.scope === "application"
            ? "This application was updated for this packet only. Application Memory was not changed."
            : "Your new Application Memory was applied. Eligibility and drafts were refreshed in the background.",
          "intelligence.updated",
        );

        const { tryNoDeadlineHostSubmitIfComplete } = await import(
          "@/server/applications/host-automation-schedule"
        );
        await tryNoDeadlineHostSubmitIfComplete({
          supabase: input.supabase,
          actor: input.actor,
          applicationId: input.applicationId,
        });
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

/** Run eligibility refresh + answer regen after the HTTP response (Need You saves stay snappy). */
function scheduleContinueApplicationInBackground(input: {
  supabase: Awaited<ReturnType<typeof requireWorkspace>>["supabase"];
  actor: Awaited<ReturnType<typeof requireWorkspace>>["actor"];
  userId: string;
  applicationId: string;
  questionIds?: string[];
  satisfiedPrompts?: string[];
  scope?: "memory" | "application";
}) {
  after(async () => {
    try {
      await continueApplicationInBackground(input);
    } catch (err) {
      logError("needs_you.continue_scheduled_failed", {
        err,
        applicationId: input.applicationId,
      });
    }
  });
}

/**
 * Shared resolver for Need You text questions.
 * scope=memory → Application Memory + this application
 * scope=application → this application only
 */
export async function fetchNeedsYouQueueAction() {
  await requireWorkspace();
  return loadNeedsYouQueue({ polish: false });
}

export async function resolveNeedsYouValue(formData: FormData): Promise<NeedsYouActionResult> {
  const { user, supabase, actor } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const inputType = String(formData.get("inputType") ?? "").trim();
  const multiValues = formData
    .getAll("value")
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  const value =
    inputType === "multi-select" || multiValues.length > 1
      ? joinNeedsYouMultiValues(multiValues)
      : multiValues[0] ?? String(formData.get("value") ?? "").trim();
  const label = String(formData.get("label") ?? "Application fact").trim();
  const profileField = (String(formData.get("profileField") ?? "").trim() || null) as ProfileMemoryField | null;
  const reviewItemId = String(formData.get("reviewItemId") ?? "").trim() || null;
  const questionId = String(formData.get("questionId") ?? "").trim() || null;
  const answerId = String(formData.get("answerId") ?? "").trim() || null;
  const mappingId = String(formData.get("mappingId") ?? "").trim() || null;
  const eligibilityId = String(formData.get("eligibilityId") ?? "").trim() || null;
  const requirementId = String(formData.get("requirementId") ?? "").trim() || null;
  const scopeRaw = String(formData.get("scope") ?? "memory").trim().toLowerCase();
  const scope: "memory" | "application" = scopeRaw === "application" ? "application" : "memory";

  if (!applicationId || !value) {
    return { ok: false, error: "required" };
  }

  let memoryValue = value;
  if (eligibilityId) {
    const eligibility = await resolveEligibilityForConfirm(
      supabase,
      user.id,
      applicationId,
      eligibilityId,
      requirementId,
    );
    const requirementText = String(eligibility?.requirement_text ?? label);
    memoryValue = expandAffirmativeAuthorizationValue(value, requirementText);
  }

  if (scope === "memory") {
    await storeMemoryValue({
      supabase,
      userId: user.id,
      label,
      value: memoryValue,
      profileField,
    });
  }

  await applyValueToApplication({
    supabase,
    userId: user.id,
    applicationId,
    label,
    value: memoryValue,
    mappingId,
    questionId,
    answerId,
    reviewItemId,
    scope,
  });

  // Clear internal review rows that should never appear in Need You.
  const { data: staleReviews } = await supabase
    .from("review_items")
    .select("id, prompt")
    .eq("application_id", applicationId)
    .eq("user_id", user.id)
    .eq("resolved", false);
  for (const row of staleReviews ?? []) {
    if (isNeedsYouSystemNoise(String(row.prompt ?? ""))) {
      await supabase.from("review_items").update({ resolved: true }).eq("id", row.id);
    }
  }

  // Re-run Fit / eligibility after the user edits a field that was blocking eligibility.
  if (eligibilityId) {
    await settleEligibilityFromApplicantAnswer({
      supabase,
      actor,
      applicationId,
      eligibilityId,
      requirementId,
      value: memoryValue,
    });
    const { data: application } = await supabase
      .from("applications")
      .select("opportunity_id")
      .eq("id", applicationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (application?.opportunity_id) {
      try {
        await evaluateApplicationIntelligence(
          supabase,
          actor,
          applicationId,
          String(application.opportunity_id),
        );
      } catch {
        // Non-fatal — Need You still saved the answer.
      }
    }
  }

  // Do not re-run eligibility for ordinary answers — it re-queues internal “Review” rows.
  await supabase
    .from("applications")
    .update({
      next_action:
        scope === "memory"
          ? "Saved to Application Memory for this application"
          : "Filled for this application only",
    })
    .eq("id", applicationId)
    .eq("user_id", user.id);

  if (scope === "memory") {
    scheduleRefreshOpenApplicationsFromKit(supabase, actor);
  }

  revalidateNeedsYou(applicationId);
  const { tryNoDeadlineHostSubmitIfComplete } = await import("@/server/applications/host-automation-schedule");
  await tryNoDeadlineHostSubmitIfComplete({ supabase, actor, applicationId });
  return { ok: true, notice: "continued" };
}

/** @deprecated Prefer resolveNeedsYouValue — kept for any stale form posts. */
export async function resolveNeedsYouMemory(formData: FormData): Promise<NeedsYouActionResult> {
  if (!formData.get("scope")) formData.set("scope", "memory");
  return resolveNeedsYouValue(formData);
}

/** @deprecated Prefer resolveNeedsYouValue */
export async function resolveNeedsYouAnswer(formData: FormData): Promise<NeedsYouActionResult> {
  if (!formData.get("scope")) formData.set("scope", "memory");
  if (!formData.get("label")) {
    const questionId = String(formData.get("questionId") ?? "");
    formData.set("label", questionId ? "Application answer" : "Application answer");
  }
  return resolveNeedsYouValue(formData);
}

export async function resolveNeedsYouDocument(formData: FormData): Promise<NeedsYouActionResult> {
  const { user, profile, supabase, actor } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "");
  const documentId = String(formData.get("documentId") ?? "").trim();
  const requiredLabel = String(formData.get("requiredLabel") ?? "").trim() || "Supporting document";
  const mappingId = String(formData.get("mappingId") ?? "").trim() || null;
  const uploadKind = String(formData.get("uploadKind") ?? "document").trim().toLowerCase() === "image" ? "image" : "document";
  const file = formData.get("file");

  if (!applicationId) {
    return { ok: false, error: "required" };
  }

  let resolvedDocumentId = documentId;
  let versionId: string | null = null;
  let uploadedMime: string | null = null;

  if (file instanceof File && file.size > 0) {
    let upload;
    try {
      upload = await readValidatedUpload(file);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof UploadValidationError && error.code === "required" ? "required" : "upload",
      };
    }

    uploadedMime = upload.mimeType;
    const isImage = IMAGE_UPLOAD_MIME_TYPES.has(upload.mimeType) || uploadKind === "image";
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
    if (uploadError) return { ok: false, error: "upload" };

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
      status: isImage ? "ready" : "processing",
    });
    await supabase.from("documents").update({ current_version_id: newVersionId }).eq("id", newDocumentId);

    await recordAuditEvent(supabase, "document.uploaded", {
      documentId: newDocumentId,
      versionId: newVersionId,
      source: "needs_you",
      uploadKind,
    });

    if (!isImage) {
      scheduleDocumentVersionProcessing({
        supabase,
        actor,
        userId: user.id,
        documentId: newDocumentId,
        versionId: newVersionId,
        documentLabel: requiredLabel,
        profileDisplayName: profile.display_name,
        fillKit: true,
      });
    }

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
      return { ok: false, error: "required" };
    }
    versionId = String(document.current_version_id);
  } else {
    return { ok: false, error: "required" };
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

  if (mappingId && versionId) {
    await supabase
      .from("field_mappings")
      .update({
        value: versionId.slice(0, 4000),
        source: uploadKind === "image" ? "Needs You image" : "Needs You document",
        confidence: 1,
        excluded_by_default: false,
        meta: {
          documentId: resolvedDocumentId,
          versionId,
          uploadKind,
          ...(uploadedMime ? { mimeType: uploadedMime } : {}),
        },
      })
      .eq("id", mappingId)
      .eq("user_id", user.id)
      .eq("application_id", applicationId);
  }

  await recordApplicationEvent(supabase, actor, applicationId, "document.attached", {
    documentId: resolvedDocumentId,
    versionId,
    source: "needs_you",
    uploadKind,
  });

  if (String(formData.get("eligibilityId") ?? "").trim()) {
    const { data: application } = await supabase
      .from("applications")
      .select("opportunity_id")
      .eq("id", applicationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (application?.opportunity_id) {
      try {
        await evaluateApplicationIntelligence(
          supabase,
          actor,
          applicationId,
          String(application.opportunity_id),
        );
      } catch {
        // Non-fatal — document is still attached.
      }
    }
  }

  scheduleContinueApplicationInBackground({
    supabase,
    actor,
    userId: user.id,
    applicationId,
  });

  revalidateNeedsYou(applicationId);
  revalidatePath("/app/documents");
  const { tryNoDeadlineHostSubmitIfComplete } = await import("@/server/applications/host-automation-schedule");
  await tryNoDeadlineHostSubmitIfComplete({ supabase, actor, applicationId });
  return { ok: true, notice: "continued" };
}

function parseNeedsYouDeadlineInput(value: string, timezone: string | null = null): string | null {
  return parseDeadlineLocalInput(value, timezone);
}

/** Applicant confirms they meet an eligibility requirement with no editable field. */
export async function confirmNeedsYouEligibility(formData: FormData): Promise<NeedsYouActionResult> {
  const { user, supabase, actor } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "").trim();
  const eligibilityId = String(formData.get("eligibilityId") ?? "").trim();
  const requirementId = String(formData.get("requirementId") ?? "").trim() || null;

  if (!applicationId || !eligibilityId) {
    return { ok: false, error: "required" };
  }

  const { data: application } = await supabase
    .from("applications")
    .select("id")
    .eq("id", applicationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!application) {
    return { ok: false, error: "not_found" };
  }

  const eligibility = await resolveEligibilityForConfirm(
    supabase,
    user.id,
    applicationId,
    eligibilityId,
    requirementId,
  );
  if (!eligibility) {
    return { ok: false, error: "confirm_failed" };
  }

  if (eligibility.user_confirmed_at) {
    revalidateNeedsYou(applicationId);
    return { ok: true, notice: "eligibility_confirmed" };
  }

  const confirmed = await settleEligibilityFromApplicantAnswer({
    supabase,
    actor,
    applicationId,
    eligibilityId,
    requirementId,
    value: "Yes",
  });
  if (!confirmed) {
    return { ok: false, error: "confirm_failed" };
  }

  await supabase
    .from("applications")
    .update({ next_action: "Eligibility confirmed — continuing application prep" })
    .eq("id", applicationId)
    .eq("user_id", user.id);

  revalidateNeedsYou(applicationId);
  const { tryNoDeadlineHostSubmitIfComplete } = await import("@/server/applications/host-automation-schedule");
  await tryNoDeadlineHostSubmitIfComplete({ supabase, actor, applicationId });
  return { ok: true, notice: "eligibility_confirmed" };
}

/** Save application deadline when LLM/ingest could not extract one. */
export async function resolveNeedsYouDeadline(formData: FormData): Promise<NeedsYouActionResult> {
  const { user, supabase, actor } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim() || null;
  const deadlineAt = parseNeedsYouDeadlineInput(String(formData.get("deadline") ?? ""), timezone);

  if (!applicationId || !deadlineAt) {
    return { ok: false, error: "required" };
  }

  if (isDeadlineInPast(deadlineAt)) {
    return { ok: false, error: "deadline_past" };
  }

  const { data: application } = await supabase
    .from("applications")
    .select("id, opportunity_id")
    .eq("id", applicationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!application) {
    return { ok: false, error: "not_found" };
  }

  const { error } = await supabase
    .from("applications")
    .update({ deadline_at: deadlineAt, deadline_timezone: timezone })
    .eq("id", applicationId)
    .eq("user_id", user.id);
  if (error) {
    return { ok: false, error: "save" };
  }

  if (application.opportunity_id) {
    await supabase
      .from("opportunities")
      .update({ deadline_at: deadlineAt })
      .eq("id", application.opportunity_id)
      .eq("user_id", user.id);
  }

  await recordApplicationEvent(supabase, actor, applicationId, "deadline.set", {
    deadlineAt,
    timezone,
    source: "needs_you",
  });

  const { syncHostAutomationForApplication } = await import("@/server/applications/host-automation-schedule");
  await syncHostAutomationForApplication({
    supabase,
    actor,
    applicationId,
    queuePrefill: false,
  });

  revalidateNeedsYou(applicationId);
  return { ok: true, notice: "saved" };
}

/**
 * Draft a Needs You text answer from Application Memory (same grounding path as
 * application answers / extension AI draft).
 */
export async function generateNeedsYouDraftAction(formData: FormData): Promise<{
  error: string | null;
  draft: string | null;
}> {
  const { supabase, actor } = await requireWorkspace();
  const applicationId = String(formData.get("applicationId") ?? "").trim();
  const questionId = String(formData.get("questionId") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const detail = String(formData.get("detail") ?? "").trim();
  const toneRaw = String(formData.get("tone") ?? "formal").trim();
  const tone =
    toneRaw === "enthusiastic" || toneRaw === "concise" || toneRaw === "detailed" ? toneRaw : "formal";

  if (!applicationId || (!questionId && !label)) {
    return { error: "required", draft: null };
  }

  const { data: application } = await supabase
    .from("applications")
    .select("id")
    .eq("id", applicationId)
    .eq("user_id", actor.userId)
    .maybeSingle();
  if (!application) return { error: "not_found", draft: null };

  try {
    if (questionId) {
      const result = await generateAnswer(supabase, actor, {
        applicationId,
        questionId,
        intent: "draft",
        tone,
      });
      const draft = String(result.text ?? "").trim();
      if (!draft) {
        return {
          error: result.warnings?.includes("INSUFFICIENT_EVIDENCE") ? "no_evidence" : "empty",
          draft: null,
        };
      }
      revalidateNeedsYou(applicationId);
      return { error: null, draft };
    }

    const { generateGroundedAiDraft } = await import("@/server/extension/enrich-ai-answers");
    const question = detail ? `${label}\n\nContext: ${detail}` : label;
    const result = await generateGroundedAiDraft({
      supabase,
      actor,
      applicationId,
      question,
    });
    const draft = String(result.draft ?? "").trim();
    if (!draft) return { error: "empty", draft: null };
    return { error: null, draft };
  } catch (error) {
    logError("needs_you.generate_draft_failed", {
      applicationId,
      message: error instanceof Error ? error.message : "unknown",
    });
    const message = error instanceof Error ? error.message : "unknown";
    if (message === "AI_UNAVAILABLE") return { error: "ai_unavailable", draft: null };
    return { error: "generate_failed", draft: null };
  }
}
