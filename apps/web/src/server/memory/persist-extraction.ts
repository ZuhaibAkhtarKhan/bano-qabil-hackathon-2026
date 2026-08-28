import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryCategory } from "@1apply/contracts";
import {
  categoryFromKind,
  detectMemoryConflicts,
  evidenceIdentityKey,
  memoryFactKey,
  type ConflictCandidate,
} from "@1apply/domain";

import type { PlannedEvidence, PlannedScalarFact } from "@/server/memory/plan-extraction";
import { mapExtractedEvidenceKind, uniqueSkillNames } from "@/lib/extraction";
import { logError, logInfo } from "@/lib/log";

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

function evidenceRowRichness(row: {
  organization?: string | null;
  situation?: string | null;
  action?: string | null;
  outcome?: string | null;
  skills?: string[] | null;
  start_date?: string | null;
  end_date?: string | null;
  source_location?: string | null;
}): number {
  let score = 0;
  if (row.organization?.trim()) score += 2;
  if (row.situation?.trim()) score += 2;
  if (row.action?.trim()) score += 2;
  if (row.outcome?.trim()) score += 2;
  if (row.start_date) score += 1;
  if (row.end_date) score += 1;
  if (row.source_location?.trim()) score += 1;
  score += Math.min(row.skills?.length ?? 0, 4);
  return score;
}

export async function loadConflictCandidates(supabase: SupabaseClient, userId: string): Promise<ConflictCandidate[]> {
  const [{ data: evidence }, { data: facts }] = await Promise.all([
    supabase
      .from("evidence_items")
      .select("id, user_id, fact_key, kind, title, organization, outcome, end_date, verification_status")
      .eq("user_id", userId),
    supabase
      .from("profile_facts")
      .select("id, user_id, fact_key, category, value, verification_status")
      .eq("user_id", userId),
  ]);

  const rows: ConflictCandidate[] = [];
  for (const item of evidence ?? []) {
    const kind = String(item.kind ?? "project");
    const title = String(item.title ?? "");
    const organization = (item.organization as string | null) ?? null;
    const category = categoryFromKind(kind);
    const factKey = evidenceIdentityKey({ kind, title, organization });
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

/** Collapse near-duplicate evidence rows; keep the richest copy. */
export async function dedupeExistingEvidence(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data: rows } = await supabase
    .from("evidence_items")
    .select(
      "id, kind, title, organization, situation, action, outcome, skills, start_date, end_date, source_location, verification_status, updated_at",
    )
    .eq("user_id", userId)
    .neq("verification_status", "rejected")
    .order("updated_at", { ascending: false });

  if (!rows?.length) return 0;

  const keepIds = new Set<string>();
  const deleteIds: string[] = [];
  const bestByKey = new Map<string, (typeof rows)[number]>();

  for (const row of rows) {
    const key = evidenceIdentityKey({
      kind: String(row.kind ?? "project"),
      title: String(row.title ?? ""),
      organization: (row.organization as string | null) ?? null,
    });
    const prev = bestByKey.get(key);
    if (!prev) {
      bestByKey.set(key, row);
      keepIds.add(row.id as string);
      continue;
    }
    const keepPrev = evidenceRowRichness(prev) >= evidenceRowRichness(row);
    if (keepPrev) {
      deleteIds.push(row.id as string);
    } else {
      deleteIds.push(prev.id as string);
      keepIds.delete(prev.id as string);
      bestByKey.set(key, row);
      keepIds.add(row.id as string);
    }
  }

  if (deleteIds.length === 0) return 0;

  await supabase.from("evidence_sources").delete().eq("user_id", userId).in("evidence_id", deleteIds);
  await supabase.from("evidence_skills").delete().eq("user_id", userId).in("evidence_id", deleteIds);
  await supabase.from("evidence_items").delete().eq("user_id", userId).in("id", deleteIds);

  for (const row of bestByKey.values()) {
    const kind = String(row.kind ?? "project");
    const title = String(row.title ?? "");
    const organization = (row.organization as string | null) ?? null;
    const category = categoryFromKind(kind);
    const factKey = memoryFactKey({
      category,
      organization,
      title,
      field: "title",
    });
    await supabase.from("evidence_items").update({ fact_key: factKey }).eq("id", row.id).eq("user_id", userId);
  }

  logInfo("memory.evidence_deduped", { userId, removed: deleteIds.length, kept: keepIds.size });
  return deleteIds.length;
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

  const { data: existingEvidence } = await supabase
    .from("evidence_items")
    .select("id, kind, title, organization, fact_key")
    .eq("user_id", userId)
    .neq("verification_status", "rejected");

  const existingIdentityKeys = new Set(
    (existingEvidence ?? []).map((row) =>
      evidenceIdentityKey({
        kind: String(row.kind ?? "project"),
        title: String(row.title ?? ""),
        organization: (row.organization as string | null) ?? null,
      }),
    ),
  );

  const insertedEvidenceIds: string[] = [];
  const seenInBatch = new Set<string>();

  for (const item of input.evidence) {
    const identityKey =
      item.identityKey ||
      evidenceIdentityKey({
        kind: item.kind,
        title: item.title,
        organization: item.organization,
      });
    if (existingIdentityKeys.has(identityKey) || seenInBatch.has(identityKey)) {
      continue;
    }
    seenInBatch.add(identityKey);

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
    existingIdentityKeys.add(identityKey);
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

  if (input.facts.length > 0) {
    const { data: existingFacts } = await supabase
      .from("profile_facts")
      .select("fact_key")
      .eq("user_id", userId);
    const existingFactKeys = new Set((existingFacts ?? []).map((row) => String(row.fact_key ?? "")));
    const newFacts = input.facts.filter((fact) => !existingFactKeys.has(fact.factKey));
    if (newFacts.length > 0) {
      await supabase.from("profile_facts").insert(
        newFacts.map((fact) => ({
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
    const names = uniqueSkillNames(input.skills);
    await supabase.from("skills").upsert(
      names.map((name) => ({
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
