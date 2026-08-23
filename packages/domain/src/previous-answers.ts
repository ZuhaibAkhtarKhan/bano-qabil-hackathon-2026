import { overlapScore } from "./text";

export type PreviousAnswerCandidate = {
  id: string;
  applicationId: string;
  questionId: string;
  prompt: string;
  text: string;
};

export type RankedPreviousAnswer = PreviousAnswerCandidate & { score: number };

export function suggestPreviousAnswers(
  question: string,
  candidates: PreviousAnswerCandidate[],
  options: { limit?: number; excludeQuestionId?: string; minScore?: number } = {},
): RankedPreviousAnswer[] {
  const limit = options.limit ?? 3;
  const minScore = options.minScore ?? 0.18;
  return candidates
    .filter((item) => item.text.trim().length > 0 && item.questionId !== options.excludeQuestionId)
    .map((item) => ({
      ...item,
      score: overlapScore(question, `${item.prompt} ${item.text}`),
    }))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
