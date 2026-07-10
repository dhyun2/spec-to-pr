import { describe, expect, it } from "vitest";

import { evaluateVisualComparison } from "../../src/visual/visual-policy.js";

describe("evaluateVisualComparison", () => {
  it("passes when review match meets threshold", () => {
    expect(
      evaluateVisualComparison({
        metrics: metrics({ exactMatchRatio: 0.5, reviewMatchRatio: 0.9 }),
        policy: {
          exactPassThreshold: 0.95,
          reviewPassThreshold: 0.8,
          reviewDistanceThreshold: 64,
          failBelowReviewThreshold: true,
        },
      }),
    ).toBe("passed");
  });

  it("can return review-needed instead of failed", () => {
    expect(
      evaluateVisualComparison({
        metrics: metrics({ exactMatchRatio: 0.5, reviewMatchRatio: 0.7 }),
        policy: {
          exactPassThreshold: 0.95,
          reviewPassThreshold: 0.8,
          reviewDistanceThreshold: 64,
          failBelowReviewThreshold: false,
        },
      }),
    ).toBe("review-needed");
  });
});

function metrics(input: { exactMatchRatio: number; reviewMatchRatio: number }) {
  return {
    width: 10,
    height: 10,
    comparedPixelCount: 100,
    maskedPixelCount: 0,
    exactMatchRatio: input.exactMatchRatio,
    reviewMatchRatio: input.reviewMatchRatio,
    meanDistance: 0,
    maxDistance: 0,
  };
}
