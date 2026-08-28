import type { SupabaseClient } from "@supabase/supabase-js";

import { tryGetAiProvider } from "@/infra/ai/openai";
import { logError } from "@/lib/log";

export type EmbeddingSourceTable =
  | "evidence_items"
  | "document_chunks"
  | "profile_facts"
  | "answer_versions"
  | "skills";

const BATCH_SIZE = 8;
const BATCH_DELAY_MS = 750;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function evidenceEmbeddingContent(row: {
  title: string;
  kind: string;
  organization: string | null;
  situation: string | null;
  action: string | null;
  outcome: string | null;
  skills: string[] | null;
}): string {
  return [row.title, row.kind, row.organization, row.situation, row.action, row.outcome, ...(row.skills ?? [])]
    .filter(Boolean)
    .join(" ")
    .slice(0, 4000);
}

export function profileFactEmbeddingContent(value: unknown): string {
  if (typeof value === "object" && value && "text" in value && typeof (value as { text: unknown }).text === "string") {
    return (value as { text: string }).text.slice(0, 4000);
  }
  return JSON.stringify(value).slice(0, 4000);
}

export async function upsertEmbedding(
  supabase: SupabaseClient,
  input: {
    userId: string;
    sourceTable: EmbeddingSourceTable;
    sourceId: string;
    content: string;
    embedding: number[];
  },
): Promise<void> {
  const trimmed = input.content.trim();
  if (!trimmed || input.embedding.length === 0) return;

  await supabase.from("embeddings").upsert(
    {
      user_id: input.userId,
      source_table: input.sourceTable,
      source_id: input.sourceId,
      content: trimmed,
      embedding: input.embedding,
    },
    { onConflict: "user_id,source_table,source_id" },
  );
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const provider = tryGetAiProvider();
  if (!provider) return [];
  return provider.embed({ texts: texts.map((text) => text.slice(0, 4000)) });
}

export async function indexRowsWithEmbeddings(
  supabase: SupabaseClient,
  userId: string,
  sourceTable: EmbeddingSourceTable,
  rows: Array<{ id: string; content: string }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  let indexed = 0;

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    let vectors: number[][] = [];
    try {
      vectors = await embedTexts(batch.map((row) => row.content));
    } catch (error) {
      logError("embeddings.batch_failed", {
        sourceTable,
        offset,
        error: String(error),
      });
      // Back off and continue with remaining batches instead of aborting the whole reindex.
      await sleep(2_000);
      continue;
    }
    if (vectors.length === 0) break;

    for (let index = 0; index < batch.length; index += 1) {
      const vector = vectors[index];
      const row = batch[index];
      if (!vector || !row?.content.trim()) continue;
      await upsertEmbedding(supabase, {
        userId,
        sourceTable,
        sourceId: row.id,
        content: row.content,
        embedding: vector,
      });
      indexed += 1;
    }

    if (offset + BATCH_SIZE < rows.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return indexed;
}

export async function indexDocumentVersionEmbeddings(
  supabase: SupabaseClient,
  userId: string,
  versionId: string,
): Promise<number> {
  const { data: chunks } = await supabase
    .from("document_chunks")
    .select("id, content")
    .eq("user_id", userId)
    .eq("document_version_id", versionId)
    .order("chunk_index", { ascending: true });

  const rows = (chunks ?? []).map((chunk) => ({
    id: chunk.id as string,
    content: String(chunk.content),
  }));

  const indexed = await indexRowsWithEmbeddings(supabase, userId, "document_chunks", rows);

  // Reuse the embeddings table vectors for chunk rows when possible — avoid a second
  // rate-limit-heavy embed pass. Only backfill document_chunks.embedding from the
  // same batch results already written above if a direct column update is needed later.
  return indexed;
}

export async function indexVerifiedEvidenceEmbeddings(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from("evidence_items")
    .select("id, title, kind, organization, situation, action, outcome, skills")
    .eq("user_id", userId)
    .eq("verification_status", "verified")
    .eq("excluded_from_ai", false);

  const rows = (data ?? []).map((row) => ({
    id: row.id as string,
    content: evidenceEmbeddingContent({
      title: String(row.title),
      kind: String(row.kind),
      organization: row.organization as string | null,
      situation: row.situation as string | null,
      action: row.action as string | null,
      outcome: row.outcome as string | null,
      skills: row.skills as string[] | null,
    }),
  }));

  return indexRowsWithEmbeddings(supabase, userId, "evidence_items", rows);
}

export async function indexVerifiedProfileFactEmbeddings(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from("profile_facts")
    .select("id, value")
    .eq("user_id", userId)
    .eq("verification_status", "verified");

  const rows = (data ?? []).map((row) => ({
    id: row.id as string,
    content: profileFactEmbeddingContent(row.value),
  }));

  return indexRowsWithEmbeddings(supabase, userId, "profile_facts", rows);
}

export async function indexApprovedAnswerEmbeddings(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from("answer_versions")
    .select("id, text")
    .eq("user_id", userId)
    .eq("approved", true);

  const rows = (data ?? [])
    .map((row) => ({ id: row.id as string, content: String(row.text) }))
    .filter((row) => row.content.trim().length > 0);

  return indexRowsWithEmbeddings(supabase, userId, "answer_versions", rows);
}

export async function indexSkillEmbeddings(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data } = await supabase.from("skills").select("id, name").eq("user_id", userId);
  const rows = (data ?? []).map((row) => ({ id: row.id as string, content: String(row.name) }));
  return indexRowsWithEmbeddings(supabase, userId, "skills", rows);
}

export async function reindexUserRetrievalCorpus(supabase: SupabaseClient, userId: string): Promise<void> {
  try {
    // Run sequentially — parallel embed bursts trip Gemini free-tier 429s after kit-fill.
    await indexVerifiedEvidenceEmbeddings(supabase, userId);
    await sleep(BATCH_DELAY_MS);
    await indexVerifiedProfileFactEmbeddings(supabase, userId);
    await sleep(BATCH_DELAY_MS);
    await indexApprovedAnswerEmbeddings(supabase, userId);
    await sleep(BATCH_DELAY_MS);
    await indexSkillEmbeddings(supabase, userId);
  } catch (error) {
    logError("embeddings.reindex_failed", { userId, error: String(error) });
  }
}
