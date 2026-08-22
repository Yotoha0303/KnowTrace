import { describe, expect, it } from "vitest";

import { rankSimilarCapture } from "./ranking";

describe("similar capture ranking", () => {
  it("keeps strong text matches without contextual overlap", () => {
    const result = rankSimilarCapture({
      textSimilarity: 0.4,
      sameSubject: false,
      sharedCategoryCount: 0,
    });

    expect(result.qualifies).toBe(true);
    expect(result.score).toBeCloseTo(0.28);
  });

  it("keeps the same described object even when wording differs", () => {
    const result = rankSimilarCapture({
      textSimilarity: 0.01,
      sameSubject: true,
      sharedCategoryCount: 0,
    });

    expect(result.qualifies).toBe(true);
    expect(result.score).toBeCloseTo(0.207);
  });

  it("requires some text overlap when only categories match", () => {
    expect(
      rankSimilarCapture({
        textSimilarity: 0.04,
        sameSubject: false,
        sharedCategoryCount: 2,
      }).qualifies,
    ).toBe(false);
    expect(
      rankSimilarCapture({
        textSimilarity: 0.05,
        sameSubject: false,
        sharedCategoryCount: 1,
      }).qualifies,
    ).toBe(true);
  });

  it("clamps malformed similarity values", () => {
    const result = rankSimilarCapture({
      textSimilarity: 2,
      sameSubject: true,
      sharedCategoryCount: 10,
    });

    expect(result.textSimilarity).toBe(1);
    expect(result.score).toBeCloseTo(1);
  });
});
