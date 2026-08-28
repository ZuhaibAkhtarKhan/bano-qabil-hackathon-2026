import { z } from "zod";
import { looksLikeFormSyntaxNoise, stripFormSyntaxDecorators } from "@1apply/form-engine";

import { tryGetAiProvider } from "@/infra/ai/openai";
import { logError } from "@/lib/log";

const cleanedLabelsSchema = z.object({
  labels: z.array(
    z.object({
      id: z.string(),
      clean: z.string(),
    }),
  ),
});

/**
 * Heuristic first, then one batched AI pass for leftover ATS chrome
 * (e.g. glued "***Obligatoriskt***" or unknown-language required badges).
 */
export async function polishFormQuestionLabels(
  items: Array<{ id: string; title: string }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const needsAi: Array<{ id: string; title: string }> = [];

  for (const item of items) {
    const heuristic = stripFormSyntaxDecorators(item.title);
    if (!heuristic) {
      out.set(item.id, item.title);
      continue;
    }
    out.set(item.id, heuristic);
    // Only escalate when chrome remains after deterministic strip (unknown language / odd ATS markup).
    if (looksLikeFormSyntaxNoise(heuristic)) {
      needsAi.push({ id: item.id, title: item.title });
    }
  }

  if (needsAi.length === 0) return out;

  const provider = tryGetAiProvider();
  if (!provider) return out;

  try {
    const raw = await provider.completeStructured({
      schemaName: "formQuestionLabelCleanup",
      instruction: `You clean scraped job-application form question labels for applicants.
Return JSON {labels:[{id, clean}]} for every input id.
Rules:
- Keep only the natural-language question the applicant should answer.
- Remove required/mandatory chrome in any language (Required, Mandatory, Obligatoriskt, Obligatorisk, Obligatoire, Obligatorio, Pflichtfeld, Erforderlich, Verplicht, Pakollinen, Wymagane, asterisks, ***, badges).
- Do not invent a new question. Do not translate unless the remaining text is only a required marker — then return empty string.
- Preserve punctuation that belongs to the question (including trailing ?).`,
      untrustedData: JSON.stringify(
        needsAi.map((item) => ({ id: item.id, label: item.title })),
      ),
    });
    const parsed = cleanedLabelsSchema.safeParse(raw);
    if (!parsed.success) return out;
    for (const row of parsed.data.labels) {
      const clean = stripFormSyntaxDecorators(String(row.clean ?? ""));
      if (clean) out.set(String(row.id), clean.slice(0, 200));
    }
  } catch (error) {
    logError("needs_you.label_polish_failed", { error: String(error), count: needsAi.length });
  }

  return out;
}
