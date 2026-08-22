const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "you",
  "are",
  "was",
  "were",
  "have",
  "has",
  "been",
  "will",
  "not",
  "but",
  "or",
  "any",
  "all",
  "can",
  "must",
  "should",
  "able",
  "into",
  "onto",
  "required",
  "requirement",
  "preferred",
]);

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+#]+/g)
    .filter((token) => token.length > 2 && !STOP.has(token));
}

export function overlapScore(query: string, corpus: string): number {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return 0;
  const corpusTokens = new Set(tokenize(corpus));
  let hit = 0;
  for (const token of queryTokens) {
    if (corpusTokens.has(token)) hit += 1;
  }
  return hit / queryTokens.size;
}

export function extractYears(value: string): number[] {
  return [...value.matchAll(/\b(19|20)\d{2}\b/g)].map((match) => Number(match[0]));
}

export function roundScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
