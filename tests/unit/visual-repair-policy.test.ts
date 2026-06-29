import { describe, expect, it } from "vitest";

import {
  decideVisualRepair,
  DEFAULT_VISUAL_REPAIR_POLICY,
} from "../../src/visual/visual-repair-policy.js";
import type { VisualReport } from "../../src/visual/visual-model.js";

describe("decideVisualRepair", () => {
  it("requests another repair attempt when any target scores below 90 percent", () => {
    const decision = decideVisualRepair({
      attempt: 1,
      report: report([
        { targetId: "hero", status: "passed", reviewMatchRatio: 0.93 },
        { targetId: "drawer", status: "failed", reviewMatchRatio: 0.87 },
      ]),
    });

    expect(decision).toMatchObject({
      status: "retry",
      score: 0.87,
      threshold: DEFAULT_VISUAL_REPAIR_POLICY.minPassingScore,
      failingTargetIds: ["drawer"],
      attemptsRemaining: 2,
      nextOwner: "design-ui",
    });
  });

  it("passes when every compared target meets the visual repair threshold", () => {
    const decision = decideVisualRepair({
      attempt: 2,
      report: report([
        { targetId: "hero", status: "passed", reviewMatchRatio: 0.91 },
        { targetId: "drawer", status: "passed", reviewMatchRatio: 0.9 },
      ]),
    });

    expect(decision).toMatchObject({
      status: "passed",
      score: 0.9,
      failingTargetIds: [],
      attemptsRemaining: 1,
    });
  });

  it("fails after the maximum repair attempt is exhausted", () => {
    const decision = decideVisualRepair({
      attempt: 3,
      report: report([{ targetId: "hero", status: "failed", reviewMatchRatio: 0.89 }]),
    });

    expect(decision).toMatchObject({
      status: "failed",
      score: 0.89,
      failingTargetIds: ["hero"],
      attemptsRemaining: 0,
      nextOwner: "human",
    });
  });
});

function report(
  results: Array<{
    targetId: string;
    status: "passed" | "failed" | "review-needed";
    reviewMatchRatio: number;
  }>,
): VisualReport {
  return {
    runId: "run_11111111111111111111111111111111",
    changeName: "visual-repair",
    generatedAt: "2026-06-29T00:00:00.000Z",
    targetCount: results.length,
    passedCount: results.filter((result) => result.status === "passed").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    reviewNeededCount: results.filter((result) => result.status === "review-needed").length,
    results: results.map((result) => ({
      targetId: result.targetId,
      status: result.status,
      figmaScreenshotArtifactId: "art_11111111111111111111111111111111",
      browserScreenshotArtifactId: "art_22222222222222222222222222222222",
      metrics: {
        width: 10,
        height: 10,
        comparedPixelCount: 100,
        maskedPixelCount: 0,
        exactMatchRatio: result.reviewMatchRatio,
        reviewMatchRatio: result.reviewMatchRatio,
        meanDistance: 0,
        maxDistance: 0,
      },
      gapIds: [],
      notes: [],
    })),
  };
}
