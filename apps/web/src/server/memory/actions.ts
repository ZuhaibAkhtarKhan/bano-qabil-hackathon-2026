"use server";

import { revalidatePath } from "next/cache";

import { experienceKindSchema } from "@1apply/contracts";
import { categoryFromKind, memoryFactKey } from "@1apply/domain";

import { documentStoragePath } from "@/infra/storage/documents";
import { loadAppConfig } from "@/config/env";
import { requireWorkspace } from "@/server/auth/require-workspace";
import { redirectWith } from "@/server/http/flash";
import { runOwnedJob } from "@/infra/jobs/runner";
import { processDocumentVersion } from "@/server/documents/service";
import { resolveMemoryConflict, syncMemoryConflicts } from "@/server/memory/persist-extraction";
import { recordAuditEvent } from "@/server/audit";
import { extractDocumentText } from "@/lib/documents/extract-text";
import { readValidatedUpload, UploadValidationError } from "@/lib/documents/upload-security";

const MEMORY = "/app/memory";

function sectionReturn(formData: FormData) {
  const section = String(formData.get("section") ?? "").trim();
  return section ? `${MEMORY}?section=${section}` : MEMORY;
}

function linesToSkills(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function parseDate(value: FormDataEntryValue | null): string | null {
  const raw = String(value ?? "").trim();
  return raw || null;
}

export async function updateIdentity(formData: FormData) {
  const { profile, supabase } = await requireWorkspace();
  const displayName = String(formData.get("displayName") ?? "").trim();
  if (!displayName) redirectWith(sectionReturn(formData), { error: "required" });

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      headline: String(formData.get("headline") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      location_city: String(formData.get("locationCity") ?? "").trim() || null,
      location_country: String(formData.get("locationCountry") ?? "").trim() || null,
      availability: String(formData.get("availability") ?? "").trim() || null,
      work_authorization: String(formData.get("workAuthorization") ?? "").trim() || null,
      timezone: String(formData.get("timezone") ?? "").trim() || null,
      linkedin_url: String(formData.get("linkedinUrl") ?? "").trim() || null,
      github_url: String(formData.get("githubUrl") ?? "").trim() || null,
      portfolio_url: String(formData.get("portfolioUrl") ?? "").trim() || null,
    })
    .eq("id", profile.id);

  if (error) redirectWith(sectionReturn(formData), { error: "save" });

  revalidatePath("/app");
  revalidatePath(MEMORY);
  redirectWith(sectionReturn(formData), { notice: "saved" });
}

export async function updateTimezone(formData: FormData) {
  const { profile, supabase } = await requireWorkspace();
  const timezone = String(formData.get("timezone") ?? "").trim() || null;
  const { error } = await supabase.from("profiles").update({ timezone }).eq("id", profile.id);
  if (error) redirectWith("/app/settings", { error: "save" });
  revalidatePath("/app");
  revalidatePath("/app/settings");
  redirectWith("/app/settings", { notice: "saved" });
}

export async function addMemoryEvidence(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const title = String(formData.get("title") ?? "").trim();
  const kindParsed = experienceKindSchema.safeParse(String(formData.get("kind") ?? "project"));
  if (!title || !kindParsed.success) redirectWith(sectionReturn(formData), { error: "required" });

  const kind = kindParsed.data;
  const category = categoryFromKind(kind);
  const organization = String(formData.get("organization") ?? "").trim() || null;
  const factKey = memoryFactKey({
    category,
    organization,
    title,
    field: parseDate(formData.get("endDate")) ? "end_year" : "title",
  });

  const { error } = await supabase.from("evidence_items").insert({
    user_id: user.id,
    title,
    kind,
    organization,
    situation: String(formData.get("situation") ?? "").trim() || null,
    action: String(formData.get("action") ?? "").trim() || null,
    outcome: String(formData.get("outcome") ?? "").trim() || null,
    skills: linesToSkills(formData.get("skills")),
    start_date: parseDate(formData.get("startDate")),
    end_date: parseDate(formData.get("endDate")),
    source: "manual",
    fact_key: factKey,
    extraction_status: "manual",
    verification_status: "unverified",
    excluded_from_ai: false,
  });

  if (error) redirectWith(sectionReturn(formData), { error: "save" });
  await syncMemoryConflicts(supabase, user.id);
  revalidatePath(MEMORY);
  redirectWith(sectionReturn(formData), { notice: "evidence_added" });
}

export async function updateMemoryEvidence(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const id = String(formData.get("evidenceId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const kindParsed = experienceKindSchema.safeParse(String(formData.get("kind") ?? "project"));
  if (!id || !title || !kindParsed.success) redirectWith(sectionReturn(formData), { error: "required" });

  const kind = kindParsed.data;
  const organization = String(formData.get("organization") ?? "").trim() || null;
  const { error } = await supabase
    .from("evidence_items")
    .update({
      title,
      kind,
      organization,
      situation: String(formData.get("situation") ?? "").trim() || null,
      action: String(formData.get("action") ?? "").trim() || null,
      outcome: String(formData.get("outcome") ?? "").trim() || null,
      skills: linesToSkills(formData.get("skills")),
      start_date: parseDate(formData.get("startDate")),
      end_date: parseDate(formData.get("endDate")),
      fact_key: memoryFactKey({
        category: categoryFromKind(kind),
        organization,
        title,
        field: parseDate(formData.get("endDate")) ? "end_year" : "title",
      }),
      extraction_status: "user_edited",
      verification_status: "unverified",
    })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) redirectWith(sectionReturn(formData), { error: "save" });
  await syncMemoryConflicts(supabase, user.id);
  revalidatePath(MEMORY);
  redirectWith(sectionReturn(formData), { notice: "saved" });
}

export async function deleteMemoryEvidence(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const id = String(formData.get("evidenceId") ?? "");
  if (!id) redirectWith(sectionReturn(formData), { error: "required" });

  const { error } = await supabase.from("evidence_items").delete().eq("id", id).eq("user_id", user.id);
  if (error) redirectWith(sectionReturn(formData), { error: "save" });

  await recordAuditEvent(supabase, "memory.evidence_deleted", { evidenceId: id });

  await syncMemoryConflicts(supabase, user.id);
  revalidatePath(MEMORY);
  redirectWith(sectionReturn(formData), { notice: "deleted" });
}

export async function addMemorySkill(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirectWith(sectionReturn(formData), { error: "required" });

  await supabase.from("skills").upsert(
    { user_id: user.id, name, normalized_name: name.toLowerCase(), source: "manual" },
    { onConflict: "user_id,normalized_name" },
  );

  await supabase.from("profile_facts").insert({
    user_id: user.id,
    category: "skills",
    fact_type: "skill",
    fact_key: memoryFactKey({ category: "skills", field: "name", title: name }),
    value: { text: name },
    source: "manual",
    extraction_status: "manual",
    verification_status: "unverified",
  });

  revalidatePath(MEMORY);
  redirectWith(sectionReturn(formData), { notice: "evidence_added" });
}

export async function deleteMemorySkill(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const id = String(formData.get("skillId") ?? "");
  if (!id) redirectWith(sectionReturn(formData), { error: "required" });
  await supabase.from("skills").delete().eq("id", id).eq("user_id", user.id);
  revalidatePath(MEMORY);
  redirectWith(sectionReturn(formData), { notice: "deleted" });
}

export async function addMemoryLink(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const url = String(formData.get("url") ?? "").trim();
  const kind = String(formData.get("kind") ?? "other");
  if (!url) redirectWith(sectionReturn(formData), { error: "required" });

  const { error } = await supabase.from("profile_links").upsert(
    {
      user_id: user.id,
      kind: kind === "linkedin" || kind === "github" || kind === "portfolio" ? kind : "other",
      url,
      label: String(formData.get("label") ?? "").trim() || kind,
    },
    { onConflict: "user_id,kind,url" },
  );
  if (error) redirectWith(sectionReturn(formData), { error: "save" });
  revalidatePath(MEMORY);
  redirectWith(sectionReturn(formData), { notice: "saved" });
}

export async function deleteMemoryLink(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const id = String(formData.get("linkId") ?? "");
  if (!id) redirectWith(sectionReturn(formData), { error: "required" });
  await supabase.from("profile_links").delete().eq("id", id).eq("user_id", user.id);
  revalidatePath(MEMORY);
  redirectWith(sectionReturn(formData), { notice: "deleted" });
}

export async function setEvidenceVerification(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const id = String(formData.get("evidenceId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || (status !== "verified" && status !== "unverified" && status !== "rejected")) {
    redirectWith(sectionReturn(formData), { error: "required" });
  }

  const { error } = await supabase
    .from("evidence_items")
    .update({ verification_status: status })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) redirectWith(sectionReturn(formData), { error: "save" });
  await syncMemoryConflicts(supabase, user.id);
  revalidatePath(MEMORY);
  redirectWith(sectionReturn(formData), { notice: status === "verified" ? "verified" : "saved" });
}

export async function setEvidenceExclusion(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const id = String(formData.get("evidenceId") ?? "");
  const excluded = String(formData.get("excluded") ?? "") === "true";
  if (!id) redirectWith(sectionReturn(formData), { error: "required" });

  const { error } = await supabase
    .from("evidence_items")
    .update({ excluded_from_ai: excluded })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) redirectWith(sectionReturn(formData), { error: "save" });

  revalidatePath(MEMORY);
  redirectWith(sectionReturn(formData), { notice: excluded ? "excluded" : "included" });
}

export async function verifyProfileFact(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const id = String(formData.get("factId") ?? "");
  if (!id) redirectWith(sectionReturn(formData), { error: "required" });

  const { error } = await supabase
    .from("profile_facts")
    .update({ verification_status: "verified" })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) redirectWith(sectionReturn(formData), { error: "save" });

  await syncMemoryConflicts(supabase, user.id);
  revalidatePath(MEMORY);
  redirectWith(sectionReturn(formData), { notice: "verified" });
}

export async function deleteProfileFact(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const id = String(formData.get("factId") ?? "");
  if (!id) redirectWith(sectionReturn(formData), { error: "required" });
  await supabase.from("profile_facts").delete().eq("id", id).eq("user_id", user.id);
  await syncMemoryConflicts(supabase, user.id);
  revalidatePath(MEMORY);
  redirectWith(sectionReturn(formData), { notice: "deleted" });
}

export async function resolveMemoryConflictAction(formData: FormData) {
  const { user, supabase } = await requireWorkspace();
  const conflictId = String(formData.get("conflictId") ?? "");
  const chosenFactId = String(formData.get("chosenFactId") ?? "");
  if (!conflictId || !chosenFactId) redirectWith(MEMORY, { error: "required" });

  await resolveMemoryConflict(supabase, user.id, conflictId, chosenFactId);
  revalidatePath(MEMORY);
  redirectWith(MEMORY, { notice: "conflict_resolved" });
}

export async function uploadMemoryDocument(formData: FormData) {
  const { user, profile, supabase, actor } = await requireWorkspace();
  const files = formData
    .getAll("file")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  const labelBase = String(formData.get("label") ?? "Supporting document").trim() || "Supporting document";
  const type = String(formData.get("type") ?? "resume");

  if (files.length === 0) redirectWith(`${MEMORY}?section=supporting`, { error: "required" });

  let notice: "uploaded" | "extracted" | "binary_stored" | "conflict_detected" = "uploaded";

  for (const [index, file] of files.entries()) {
    let upload;
    try {
      upload = await readValidatedUpload(file);
    } catch (error) {
      redirectWith(
        `${MEMORY}?section=supporting`,
        { error: error instanceof UploadValidationError && error.code === "required" ? "required" : "upload" },
      );
    }

    const label = files.length > 1 ? `${labelBase} (${index + 1})` : labelBase;
    const documentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const storagePath = documentStoragePath({
      actor,
      documentId,
      versionId,
      type: type === "resume" ? "resume" : "other",
      fileName: upload.sanitizedFilename,
    });
    const bucket = loadAppConfig().storageBucket;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(storagePath, upload.buffer, { contentType: upload.mimeType, upsert: false });
    if (uploadError) redirectWith(`${MEMORY}?section=supporting`, { error: "upload" });

    await supabase.from("documents").insert({
      id: documentId,
      user_id: user.id,
      type: type === "resume" ? "resume" : "other",
      label,
    });
    await supabase.from("document_versions").insert({
      id: versionId,
      document_id: documentId,
      user_id: user.id,
      version_label: "v1",
      storage_path: storagePath,
      file_hash: upload.fileHash,
      mime_type: upload.mimeType,
      byte_size: upload.buffer.length,
      status: "processing",
    });
    await supabase.from("documents").update({ current_version_id: versionId }).eq("id", documentId);
    if (type === "resume") {
      await supabase.from("resumes").upsert({ document_id: documentId, user_id: user.id }, { onConflict: "document_id" });
    }

    const extractedText = await extractDocumentText(upload.buffer, upload.mimeType);
    if (extractedText) notice = "extracted";
    else notice = "binary_stored";

    await recordAuditEvent(supabase, "document.uploaded", { documentId, versionId, source: "memory" });

    await runOwnedJob(supabase, { actor, type: "document_extract", inputRef: versionId }, async () => {
      await processDocumentVersion({
        supabase,
        userId: user.id,
        documentId,
        versionId,
        documentLabel: label,
        profileDisplayName: profile.display_name,
        buffer: upload.buffer,
        mimeType: upload.mimeType,
      });
    });
  }

  revalidatePath(MEMORY);
  revalidatePath("/app/documents");
  redirectWith(`${MEMORY}?section=supporting`, { notice });
}
