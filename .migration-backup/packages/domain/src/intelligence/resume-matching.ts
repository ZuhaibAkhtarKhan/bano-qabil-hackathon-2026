import { overlapScore, roundScore, tokenize } from "./text";
import type { ResumeCandidate, ResumeTrack } from "./types";

export const RESUME_TRACKS: Array<{ id: ResumeTrack; label: string; keywords: string[] }> = [
  { id: "software_engineering", label: "Software Engineering", keywords: ["software", "backend", "fullstack", "engineer", "sde", "java", "python"] },
  { id: "ai_ml", label: "AI/ML", keywords: ["ai", "ml", "machine", "learning", "nlp", "model", "pytorch", "tensorflow", "data"] },
  { id: "web_development", label: "Web Development", keywords: ["web", "react", "next", "frontend", "javascript", "css", "html"] },
  { id: "research", label: "Research", keywords: ["research", "paper", "thesis", "phd", "publication", "lab"] },
  { id: "general", label: "General", keywords: ["general", "resume", "cv"] },
];

export type RankedResume = ResumeCandidate & {
  track: ResumeTrack;
  trackLabel: string;
  score: number;
  explanation: string;
  recommended: boolean;
  suggestion: string | null;
};

const WEAK_THRESHOLD = 40;

export function classifyResumeTrack(label: string, type?: string, content?: string | null): ResumeTrack {
  const blob = `${label} ${type ?? ""} ${content ?? ""}`.toLowerCase();
  let best: { id: ResumeTrack; hits: number } = { id: "general", hits: 0 };
  for (const track of RESUME_TRACKS) {
    if (track.id === "general") continue;
    const hits = track.keywords.filter((keyword) => blob.includes(keyword)).length;
    if (hits > best.hits) best = { id: track.id, hits };
  }
  return best.hits > 0 ? best.id : "general";
}

export function dominantOpportunityTrack(opportunityText: string): ResumeTrack {
  return classifyResumeTrack(opportunityText, "opportunity", opportunityText);
}

function trackLabel(id: ResumeTrack): string {
  return RESUME_TRACKS.find((track) => track.id === id)?.label ?? "General";
}

export function rankResumes(
  opportunityText: string,
  resumes: ResumeCandidate[],
): RankedResume[] {
  if (resumes.length === 0) return [];
  const targetTrack = dominantOpportunityTrack(opportunityText);
  const ranked = resumes
    .map((resume) => {
      const content = resume.content?.trim() || "";
      const track = classifyResumeTrack(resume.label, resume.type, content);
      const lexical = overlapScore(opportunityText, `${resume.label} ${resume.type} ${content}`);
      const affinity = track === targetTrack ? 1 : track === "general" ? 0.45 : 0.2;
      const score = roundScore((lexical * 0.55 + affinity * 0.45) * 100);
      const usedBody = content.length > 0;
      const explanation = usedBody
        ? `${trackLabel(track)} resume scored ${score}% from label, type, and stored resume text against this posting. Track affinity to ${trackLabel(targetTrack)} is included. No unlisted experience was assumed.`
        : `${trackLabel(track)} resume scored ${score}% from label and type only. No resume body was available, so this is not a claim about unlisted experience.`;
      return {
        ...resume,
        track,
        trackLabel: trackLabel(track),
        score,
        explanation,
        recommended: false,
        suggestion: null as string | null,
      };
    })
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  const best = ranked[0];
  if (best) {
    best.recommended = true;
    if (best.score < WEAK_THRESHOLD) {
      const wanted = trackLabel(targetTrack);
      best.suggestion = `None of the current resumes are a strong match. A ${wanted} resume that highlights verified evidence already in Application Memory would fit better. Do not invent experience.`;
    } else {
      best.suggestion = `Use the ${best.trackLabel} version. ${best.explanation}`;
    }
  }

  return ranked;
}

export function resumeMatchSummary(ranked: RankedResume[]): string {
  if (ranked.length === 0) return "No resumes to compare.";
  return ranked.map((item) => `${item.trackLabel} — ${item.score}%`).join("\n");
}

export function evidenceTokensForSelection(question: string, blob: string): number {
  const query = new Set(tokenize(question));
  const corpus = new Set(tokenize(blob));
  let hit = 0;
  for (const token of query) {
    if (corpus.has(token)) hit += 1;
  }
  return hit;
}
