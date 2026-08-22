import type { SupabaseClient } from "@supabase/supabase-js";

import { documentExtractionSchema, tryGetAiProvider } from "@/server/ai/openai";
import { logError } from "@/lib/log";
import { wrapUntrustedDocumentContent } from "@/lib/opportunities/untrusted";
import { planDocumentExtraction } from "@/server/memory/plan-extraction";
import { loadConflictCandidates, persistDocumentExtraction } from "@/server/memory/persist-extraction";

export async function extractFromDocumentText(input: {
  supabase: SupabaseClient;
  userId: string;
  documentId: string;
  versionId: string;
  documentLabel: string;
  extractedText: string;
  profileDisplayName: string | null;
}) {
  const existing = await loadConflictCandidates(input.supabase, input.userId);
  const provider = tryGetAiProvider();
  if (!provider) {
    return { extracted: false as const };
  }

  try {
    const raw = await provider.completeStructured({
      schemaName: "documentExtraction",
      instruction: `Extract only facts the document states about ${input.profileDisplayName ?? "the applicant"}. Return JSON {displayName, headline, phone, locationCity, locationCountry, links:[{kind,url}], skills:[], evidence:[{title,kind,organization,situation,action,outcome,skills[],startDate,endDate,excerpt}]}. Map kinds to education, employment, project, leadership, volunteering, achievement, certification, or research. Include graduation/end years in endDate when present. Never invent employers, dates, skills, or outcomes. If unsure, omit the item.`,
      untrustedData: wrapUntrustedDocumentContent(input.extractedText, input.documentLabel),
    });
    const parsed = documentExtractionSchema.safeParse(raw);
    if (!parsed.success) {
      return { extracted: false as const };
    }

    const plan = planDocumentExtraction(parsed.data, existing);
    await persistDocumentExtraction(input.supabase, {
      userId: input.userId,
      documentId: input.documentId,
      versionId: input.versionId,
      documentLabel: input.documentLabel,
      evidence: plan.evidence,
      facts: plan.facts,
      skills: plan.skills,
      links: plan.links,
      profilePatch: {
        displayName: parsed.data.displayName,
        headline: parsed.data.headline,
        phone: parsed.data.phone ?? null,
        locationCity: parsed.data.locationCity ?? null,
        locationCountry: parsed.data.locationCountry ?? null,
      },
    });
    return { extracted: true as const, conflictCount: plan.conflicts.length };
  } catch {
    logError("memory.extract_ai_failed", { versionId: input.versionId });
    return { extracted: false as const };
  }
}
