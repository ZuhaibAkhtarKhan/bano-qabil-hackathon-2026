import type { SupabaseClient } from "@supabase/supabase-js";

import { documentExtractionSchema, tryGetAiProvider } from "@/infra/ai/openai";
import { normalizeDocumentExtractionRaw } from "@/lib/kit-fill-normalize";
import { logError } from "@/lib/log";
import { wrapUntrustedDocumentContent } from "@/lib/opportunities/untrusted";
import { heuristicExtractDocument } from "@/server/memory/heuristic-extract";
import { planDocumentExtraction } from "@/server/memory/plan-extraction";
import { loadConflictCandidates, persistDocumentExtraction } from "@/server/memory/persist-extraction";
import type { ExtractedDocument } from "@/server/memory/plan-extraction";

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

  const persist = async (extracted: ExtractedDocument) => {
    const plan = planDocumentExtraction(extracted, existing);
    const existingKeys = new Set(existing.map((row) => row.factKey));
    const newEvidence = plan.evidence.filter((item) => !existingKeys.has(item.identityKey));
    const hasSignal =
      newEvidence.length > 0 || plan.facts.length > 0 || plan.skills.length > 0 || plan.links.length > 0;
    if (!hasSignal) return { extracted: false as const, fieldsWritten: 0 };
    const result = await persistDocumentExtraction(input.supabase, {
      userId: input.userId,
      documentId: input.documentId,
      versionId: input.versionId,
      documentLabel: input.documentLabel,
      evidence: newEvidence,
      facts: plan.facts,
      skills: plan.skills,
      links: plan.links,
      profilePatch: {
        displayName: extracted.displayName,
        headline: extracted.headline,
        phone: extracted.phone ?? null,
        locationCity: extracted.locationCity ?? null,
        locationCountry: extracted.locationCountry ?? null,
      },
    });
    const fieldsWritten =
      result.insertedEvidenceIds.length + plan.facts.length + plan.skills.length + plan.links.length;
    return {
      extracted: fieldsWritten > 0,
      conflictCount: plan.conflicts.length,
      fieldsWritten,
    };
  };

  const provider = tryGetAiProvider();
  if (provider) {
    try {
      const raw = await provider.completeStructured({
        schemaName: "documentExtraction",
        instruction: `Extract profile data for ${input.profileDisplayName ?? "the applicant"} from the document. Be confident when the text clearly supports a field. Return JSON {displayName, headline, phone, locationCity, locationCountry, links:[{kind,url}], skills:[], evidence:[{title,kind,organization,situation,action,outcome,skills[],startDate,endDate,excerpt}]}. Read the entire document and map each entry to the correct kit section via kind: education, employment, project, leadership, volunteering, achievement, certification, or research. Include skills from dedicated skills sections AND technologies mentioned in jobs/projects. For CNIC, B-form, or identity documents, extract legal name, ID number, and address into displayName, phone, locationCity, locationCountry. Pull resume bullets into situation/action/outcome. Include graduation/end years in endDate. Do not fabricate facts absent from the text, but do include everything the document clearly contains.`,
        untrustedData: wrapUntrustedDocumentContent(input.extractedText, input.documentLabel),
      });
      const parsed = documentExtractionSchema.safeParse(normalizeDocumentExtractionRaw(raw));
      if (parsed.success) {
        return persist(parsed.data);
      }
    } catch {
      logError("memory.extract_ai_failed", { versionId: input.versionId });
    }
  }

  return persist(heuristicExtractDocument(input.extractedText, input.documentLabel));
}
