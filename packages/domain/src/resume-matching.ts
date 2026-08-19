import { clampScore, overlapScore, tokenize } from "./text";
import type { ResumeCandidate } from "./intelligence-types";

export const RESUME_FOCUSES = [
  {
    id: "software_engineering",
    label: "Software Engineering",
    aliases: ["software", "swe", "engineer", "backend", "systems"],
  },
  {
    id: "ai_ml",
    label: "AI/ML",
    aliases: ["ai", "ml", "machine", "learning", "deep", "nlp", "llm"],
  },
  {
    id: "web_development",
    label: "Web Development",
    aliases: ["web", "frontend", "front", "fullstack", "react", "next"],
  },
  {
    id: "research",
    label: "Research",
    aliases: ["research", "academic", "paper", "thesis"],
  },
  {
    id: "general",
    label: "General",
    aliases: ["general", "resume", "cv"],
  },
] as const;

export type ResumeFocusId = (typeof RESUME_FOCUSES)[number]["id"];

export type RankedResume = ResumeCandidate & {
  score: number;
  focus: ResumeFocusId;
  focusLabel: string;
  recommended: boolean;
  explanation: string;
  strengths: string[];
  gaps: string[];
  suggestion: string | null;
};

const RELATED: Record<ResumeFocusId, ResumeFocusId[]> = {
  software_engineering: ["web_development", "ai_ml"],
  ai_ml: ["research", "software_engineering"],
  web_development: ["software_engineering"],
  research: ["ai_ml"],
  general: [],
};

export function classifyResumeFocus(label: string, text = ""): (typeof RESUME_FOCUSES)[number] {
  const blob = `${label} ${text}`.toLowerCase();
  let best = RESUME_FOCUSES[RESUME_FOCUSES.length - 1]!;
  let bestHits = 0;
  for (const focus of RESUME_FOCUSES) {
    if (focus.id === "general") continue;
    const hits = focus.aliases.filter((alias) => blob.includes(alias)).length;
    if (hits > bestHits) {
      best = focus;
      bestHits = hits;
    }
  }
  if (bestHits === 0) return RESUME_FOCUSES.find((item) => item.id === "general")!;
  return best;
}

export function classifyOpportunityFocus(opportunityText: string): (typeof RESUME_FOCUSES)[number] {
  return classifyResumeFocus(opportunityText, opportunityText);
}

function focusAlignment(resumeFocus: ResumeFocusId, opportunityFocus: ResumeFocusId): number {
  if (resumeFocus === opportunityFocus && resumeFocus !== "general") return 40;
  if (RELATED[resumeFocus]?.includes(opportunityFocus) || RELATED[opportunityFocus]?.includes(resumeFocus)) return 22;
  if (resumeFocus === "general") return 12;
  return 6;
}

function suggestedFocusLabel(opportunityFocus: (typeof RESUME_FOCUSES)[number]): string {
  if (opportunityFocus.id === "general") return "a more targeted resume";
  return `a ${opportunityFocus.label} resume`;
}

export function rankResumes(
  opportunityText: string,
  resumes: ResumeCandidate[],
  options: { memoryHighlights?: string[] } = {},
): RankedResume[] {
  if (resumes.length === 0) return [];
  const opportunityFocus = classifyOpportunityFocus(opportunityText);

  const ranked = resumes
    .map((resume) => {
      const text = resume.text?.trim() ?? "";
      const focus = classifyResumeFocus(resume.label, text);
      const alignment = focusAlignment(focus.id, opportunityFocus.id);
      const contentSource = text || `${resume.label} ${resume.type}`;
      const overlap = overlapScore(opportunityText, contentSource);
      const contentScore = text ? clampScore(overlap * 60) : clampScore(overlap * 25);
      const score = clampScore(alignment + contentScore);
      const strengths: string[] = [];
      const gaps: string[] = [];

      if (focus.id === opportunityFocus.id && focus.id !== "general") {
        strengths.push(`Labeled as ${focus.label}, which matches this opportunity.`);
      }
      const shared = tokenize(opportunityText).filter((token) => tokenize(contentSource).includes(token)).slice(0, 6);
      if (shared.length > 0) {
        strengths.push(`Overlapping terms: ${shared.join(", ")}.`);
      }
      if (!text) {
        gaps.push("Resume text is not extracted, so ranking uses the label only — not invented experience.");
      }
      if (focus.id !== opportunityFocus.id && opportunityFocus.id !== "general") {
        gaps.push(`This file is closer to ${focus.label} than to ${opportunityFocus.label}.`);
      }

      const explanation = `${focus.label} scored ${score}% from focus alignment (${alignment}) plus evidenced overlap (${contentScore}). No experience was invented.`;

      return {
        ...resume,
        score,
        focus: focus.id,
        focusLabel: focus.label,
        recommended: false,
        explanation,
        strengths,
        gaps,
        suggestion: null as string | null,
      };
    })
    .sort((a, b) => b.score - a.score);

  const highlights = (options.memoryHighlights ?? []).filter(Boolean).slice(0, 4);
  const highlightPhrase =
    highlights.length > 0
      ? `foreground verified ${highlights.join(", ")} already in Application Memory`
      : "foreground verified projects already in Application Memory";

  return ranked.map((resume, index) => {
    const recommended = index === 0 && ranked.length > 0;
    const weak = recommended && resume.score < 55;
    const suggestion = weak
      ? `Current resumes are a weak lexical match. Consider ${suggestedFocusLabel(opportunityFocus)} that ${highlightPhrase} — do not invent new ones.`
      : null;
    return {
      ...resume,
      recommended,
      suggestion,
    };
  });
}
