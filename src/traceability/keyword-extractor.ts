import { tokenizeTraceText } from "./text-normalizer.js";

export type KeywordSet = {
  keywords: string[];
  keywordSet: Set<string>;
};

export function extractKeywords(input: string): KeywordSet {
  const tokens = tokenizeTraceText(input);
  const counted = new Map<string, number>();

  for (const token of tokens) {
    counted.set(token, (counted.get(token) ?? 0) + 1);
  }

  const keywords = [...counted.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([token]) => token)
    .slice(0, 20);

  return {
    keywords,
    keywordSet: new Set(keywords),
  };
}

export function keywordOverlap(
  left: string[],
  right: string[],
): {
  count: number;
  shared: string[];
  score: number;
} {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const shared = [...leftSet].filter((keyword) => rightSet.has(keyword));

  const denominator = Math.max(1, Math.min(leftSet.size, rightSet.size));
  const score = shared.length / denominator;

  return {
    count: shared.length,
    shared,
    score,
  };
}
