import { eligibleEvidence, rankEvidenceForQuestion, type MemoryEvidence } from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { tryGetAiProvider } from "@/infra/ai/openai";
import { mapEvidence } from "@/server/memory/map-evidence";
import type { EmbeddingSourceTable } from "@/services/embeddings";
import type { EvidenceRow } from "@/server/types";

export type RetrievedChunk = {
  id: string;
  sourceTable: EmbeddingSourceTable;
  sourceId: string;
  content: string;
  similarity: number;
};

export type RetrievalResult = {
  evidence: MemoryEvidence[];
  chunks: RetrievedChunk[];
  rankedEvidenceIds: string[];
};

export async function loadOwnedEvidence(
  supabase: SupabaseClient,
  actor: Actor,
): Promise<MemoryEvidence[]> {
  const { data } = await supabase
    .from("evidence_items")
    .select(
      "id, title, kind, organization, situation, action, outcome, skills, verification_status, excluded_from_ai",
    )
    .eq("user_id", actor.userId);
  return ((data ?? []) as EvidenceRow[]).map(mapEvidence);
}

function mergeRankedEvidence(
  lexical: MemoryEvidence[],
  semanticEvidence: MemoryEvidence[],
  limit: number,
): MemoryEvidence[] {
  const merged: MemoryEvidence[] = [];
  const seen = new Set<string>();
  for (const item of [...lexical, ...semanticEvidence]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
    if (merged.length >= limit) break;
  }
  return merged;
}

export async function vectorSearch(
  supabase: SupabaseClient,
  queryVector: number[],
  limit: number,
  filterSource?: EmbeddingSourceTable | null,
): Promise<RetrievedChunk[]> {
  const { data } = await supabase.rpc("match_user_embeddings", {
    query_embedding: queryVector,
    match_count: limit,
    filter_source: filterSource ?? null,
  });

  return ((data ?? []) as Array<{
    id: string;
    source_table: EmbeddingSourceTable;
    source_id: string;
    content: string;
    similarity: number;
  }>).map((row) => ({
    id: row.id,
    sourceTable: row.source_table,
    sourceId: row.source_id,
    content: row.content,
    similarity: row.similarity,
  }));
}

export async function retrieveForGrounding(
  supabase: SupabaseClient,
  actor: Actor,
  question: string,
  options: {
    limit?: number;
    sourceFilter?: EmbeddingSourceTable | null;
  } = {},
): Promise<RetrievalResult> {
  const limit = options.limit ?? 4;
  const evidence = await loadOwnedEvidence(supabase, actor);
  const lexical = rankEvidenceForQuestion(question, evidence, limit);

  const provider = tryGetAiProvider();
  if (!provider) {
    return {
      evidence: lexical,
      chunks: [],
      rankedEvidenceIds: lexical.map((item) => item.id),
    };
  }

  try {
    const [queryVector] = await provider.embed({ texts: [question.slice(0, 4000)] });
    if (!queryVector) {
      return {
        evidence: lexical,
        chunks: [],
        rankedEvidenceIds: lexical.map((item) => item.id),
      };
    }

    const chunks = await vectorSearch(supabase, queryVector, limit * 2, options.sourceFilter ?? null);
    const byId = new Map(eligibleEvidence(evidence).map((item) => [item.id, item]));
    const semanticEvidence: MemoryEvidence[] = [];

    for (const chunk of chunks) {
      if (chunk.sourceTable !== "evidence_items") continue;
      const item = byId.get(chunk.sourceId);
      if (item) semanticEvidence.push(item);
    }

    const merged = mergeRankedEvidence(lexical, semanticEvidence, limit);
    return {
      evidence: merged,
      chunks,
      rankedEvidenceIds: merged.map((item) => item.id),
    };
  } catch {
    return {
      evidence: lexical,
      chunks: [],
      rankedEvidenceIds: lexical.map((item) => item.id),
    };
  }
}

/** @deprecated Use retrieveForGrounding */
export async function retrieveEvidenceForQuestion(
  supabase: SupabaseClient,
  actor: Actor,
  question: string,
  limit = 4,
): Promise<MemoryEvidence[]> {
  const result = await retrieveForGrounding(supabase, actor, question, { limit });
  return result.evidence;
}

export async function selectEvidenceForQuestion(
  supabase: SupabaseClient,
  actor: Actor,
  question: string,
  limit = 4,
): Promise<RetrievalResult> {
  return retrieveForGrounding(supabase, actor, question, { limit });
}
