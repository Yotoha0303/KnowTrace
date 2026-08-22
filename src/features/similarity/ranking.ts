export const MIN_TEXT_SIMILARITY = 0.12;
export const MIN_CATEGORY_TEXT_SIMILARITY = 0.05;

export type SimilaritySignals = {
  textSimilarity: number;
  sameSubject: boolean;
  sharedCategoryCount: number;
};

export function rankSimilarCapture(signals: SimilaritySignals) {
  const textSimilarity = Math.min(Math.max(signals.textSimilarity, 0), 1);
  const sharedCategoryCount = Math.max(Math.trunc(signals.sharedCategoryCount), 0);
  const score =
    textSimilarity * 0.7 +
    (signals.sameSubject ? 0.2 : 0) +
    Math.min(sharedCategoryCount * 0.05, 0.1);
  const qualifies =
    signals.sameSubject ||
    textSimilarity >= MIN_TEXT_SIMILARITY ||
    (sharedCategoryCount > 0 && textSimilarity >= MIN_CATEGORY_TEXT_SIMILARITY);

  return {
    qualifies,
    score: Math.min(score, 1),
    textSimilarity,
  };
}
