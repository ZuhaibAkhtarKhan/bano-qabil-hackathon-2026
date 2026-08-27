import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryCategory } from "@1apply/contracts";
import { categoryFromKind, detectMemoryConflicts, memoryFactKey, type ConflictCandidate } from "@1apply/domain";

import type { PlannedEvidence, PlannedScalarFact } from "@/server/memory/plan-extraction";
import { mapExtractedEvidenceKind, uniqueSkillNames } from "@/lib/extraction";
import { logError } from "@/lib/log";

type PersistInput = {
  userId: string;
  documentId: string;
  versionId: string;
  documentLabel: string;
  evidence: PlannedEvidence[];
  facts: PlannedScalarFact[];
  skills: string[];
  links: Array<{ kind: "linkedin" | "github" | "portfolio" | "other"; url: string }>;
  profilePatch?: {
    displayName?: string | null;
    headline?: string | null;
    phone?: string | null;
    locationCity?: string | null;
    locationCountry?: string | null;
  };
};

export async function loadConflictCandidates(supabase: SupabaseClient, userId: string): Promise<ConflictCandidate[]> {
  const [{ data: evidence }, { data: facts }] = await Promise.all([
    supabase
      .from("evidence_items")
      .select("id, user_id, fact_key, kind, title, outcome, end_date, verification_status")
      .eq("user_id", userId),
    supabase
      .from("profile_facts")
      .select("id, user_id, fact_key, category, value, verification_status")
      .eq("user_id", userId),
  ]);

  const rows: ConflictCandidate[] = [];
  for (const item of evidence ?? []) {
    const category = categoryFromKind(String(item.kind));
    const factKey =
      (item.fact_key as string | null) ??
      memoryFactKey({
        category,
        organization: null,
        title: item.title as string,
        field: item.end_date ? "end_year" : "title",
      });
    rows.push({
      id: item.id as string,
      userId: item.user_id as string,
      factKey,
      category,
      value: String(item.end_date ?? item.outcome ?? item.title ?? ""),
      verificationStatus: item.verification_status as "unverified" | "verified" | "rejected",
    });
  }
  for (const item of facts ?? []) {
    rows.push({
      id: item.id as string,
      userId: item.user_id as string,
      factKey: item.fact_key as string,
      category: item.category as MemoryCategory,
      value: String((item.value as { text?: string } | null)?.text ?? JSON.stringify(item.value ?? "")),
      verificationStatus: item.verification_status as "unverified" | "verified" | "rejected",
    });
  }
  return rows;
}

export async function persistDocumentExtraction(supabase: SupabaseClient, input: PersistInput) {
  const { userId, documentId, versionId, documentLabel } = input;

  if (input.profilePatch?.displayName || input.profilePatch?.headline || input.profilePatch?.phone) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();

    const existingName = String(profile?.display_name ?? "").trim();
    const extractedName = String(input.profilePatch.displayName ?? "").trim();
    const extractedLooksLikeName =
      Boolean(extractedName) &&
      !/resume|curriculum|\bcv\b|primary|document|upload|supporting|file/i.test(extractedName);
    // Keep the signup/onboarding name. Only fill an empty profile name from extraction.
    const nextDisplayName =
      !existingName && extractedLooksLikeName
        ? extractedName
        : existingName && /resume|curriculum|\bcv\b|primary resume/i.test(existingName) && extractedLooksLikeName
          ? extractedName
          : null;

    await supabase
      .from("profiles")
      .update({
        ...(nextDisplayName ? { display_name: nextDisplayName } : {}),
        ...(input.profilePatch.headline ? { headline: input.profilePatch.headline } : {}),
        ...(input.profilePatch.phone ? { phone: input.profilePatch.phone } : {}),
        ...(input.profilePatch.locationCity ? { location_city: input.profilePatch.locationCity } : {}),
        ...(input.profilePatch.locationCountry ? { location_country: input.profilePatch.locationCountry } : {}),
      })
      .eq("id", userId);
  }

  const insertedEvidenceIds: string[] = [];
  if (input.evidence.length > 0) {
    for (const item of input.evidence) {
      const row = {
        user_id: userId,
        title: item.title,
        kind: item.kind,
        organization: item.organization,
        situation: item.situation,
        action: item.action,
        outcome: item.outcome,
        skills: item.skills,
        start_date: item.startDate,
        end_date: item.endDate,
        source: `document:${documentId}`,
        source_document_id: documentId,
        source_version_id: versionId,
        source_location: item.excerpt,
        fact_key: item.factKey,
        extraction_status: item.extractionStatus,
        verification_status: item.verificationStatus,
        excluded_from_ai: false,
      };
      const { data: inserted, error: evidenceError } = await supabase
        .from("evidence_items")
        .insert(row)
        .select("id, skills, fact_key")
        .maybeSingle();
      if (evidenceError || !inserted) {
        logError("memory.persist_evidence_failed", {
          message: evidenceError?.message ?? "no row",
          code: evidenceError?.code,
          title: item.title,
          startDate: item.startDate,
          endDate: item.endDate,
        });
        continue;
      }
      insertedEvidenceIds.push(inserted.id as string);
      await supabase.from("evidence_sources").insert({
        user_id: userId,
        evidence_id: inserted.id,
        source_kind: "document_version",
        source_ref: versionId,
        excerpt: item.excerpt ?? null,
      });
      await syncSkills(supabase, userId, [
        { id: inserted.id as string, skills: inserted.skills as string[] | null },
      ]);
    }
  }

  if (input.facts.length > 0) {
    await supabase.from("profile_facts").insert(
      input.facts.map((fact) => ({
        user_id: userId,
        category: fact.category,
        fact_type: fact.factKey.split(":").pop() ?? "value",
        fact_key: fact.factKey,
        value: { text: fact.value },
        source: `document:${documentId}`,
        source_document_id: documentId,
        source_version_id: versionId,
        extraction_status: fact.extractionStatus,
        verification_status: fact.verificationStatus,
      })),
    );
  }

  for (const link of input.links) {
    await supabase.from("profile_links").upsert(
      {
        user_id: userId,
        kind: link.kind,
        url: link.url,
        label: link.kind,
      },
      { onConflict: "user_id,kind,url", ignoreDuplicates: false },
    );
  }

  if (input.skills.length > 0) {
    await supabase.from("skills").upsert(
      input.skills.map((name) => ({
        user_id: userId,
        name,
        normalized_name: name.toLowerCase(),
        source: `document:${documentId}`,
      })),
      { onConflict: "user_id,normalized_name", ignoreDuplicates: true },
    );
  }

  await syncMemoryConflicts(supabase, userId);
  return { insertedEvidenceIds, documentLabel };
}

async function syncSkills(
  supabase: SupabaseClient,
  userId: string,
  evidenceRows: Array<{ id: string; skills: string[] | null }>,
) {
  const names = uniqueSkillNames(evidenceRows.flatMap((row) => row.skills ?? []));
  if (names.length === 0) return;
  await supabase.from("skills").upsert(
    names.map((name) => ({ user_id: userId, name, normalized_name: name.toLowerCase(), source: "document_extract" })),
    { onConflict: "user_id,normalized_name", ignoreDuplicates: true },
  );
  const { data: skills } = await supabase.from("skills").select("id, normalized_name").eq("user_id", userId);
  const byName = new Map((skills ?? []).map((item) => [item.normalized_name as string, item.id as string]));
  for (const evidence of evidenceRows) {
    for (const skill of evidence.skills ?? []) {
      const skillId = byName.get(skill.trim().toLowerCase());
      if (!skillId) continue;
      await supabase.from("evidence_skills").upsert(
        { user_id: userId, evidence_id: evidence.id, skill_id: skillId },
        { onConflict: "evidence_id,skill_id", ignoreDuplicates: true },
      );
    }
  }
}

export async function syncMemoryConflicts(supabase: SupabaseClient, userId: string) {
  const candidates = await loadConflictCandidates(supabase, userId);
  const detected = detectMemoryConflicts(candidates);

  await supabase.from("memory_conflicts").delete().eq("user_id", userId).eq("status", "open");

  if (detected.length === 0) return;

  await supabase.from("memory_conflicts").insert(
    detected.map((item) => ({
      user_id: userId,
      fact_key: item.factKey,
      category: item.category,
      status: "open",
      fact_ids: item.factIds,
      values: item.values,
    })),
  );
}

export async function resolveMemoryConflict(
  supabase: SupabaseClient,
  userId: string,
  conflictId: string,
  chosenFactId: string,
) {
  const { data: conflict } = await supabase
    .from("memory_conflicts")
    .select("id, fact_ids, status")
    .eq("id", conflictId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!conflict || conflict.status !== "open") return;

  const factIds = (conflict.fact_ids as string[]) ?? [];
  const rejectIds = factIds.filter((id) => id !== chosenFactId);

  if (rejectIds.length > 0) {
    await supabase.from("evidence_items").update({ verification_status: "rejected" }).in("id", rejectIds);
    await supabase.from("profile_facts").update({ verification_status: "rejected" }).in("id", rejectIds);
  }

  await supabase
    .from("evidence_items")
    .update({ verification_status: "verified" })
    .eq("id", chosenFactId)
    .eq("user_id", userId);
  await supabase
    .from("profile_facts")
    .update({ verification_status: "verified" })
    .eq("id", chosenFactId)
    .eq("user_id", userId);

  await supabase
    .from("memory_conflicts")
    .update({ status: "resolved", chosen_fact_id: chosenFactId, resolved_at: new Date().toISOString() })
    .eq("id", conflictId)
    .eq("user_id", userId);

  await syncMemoryConflicts(supabase, userId);
}

export { mapExtractedEvidenceKind };
