import { describe, expect, it } from "vitest";

import {
  WorkloadEstimateSchema,
  WorkloadSignalsSchema,
  estimateWorkload,
} from "../../src/workflow/index.js";

describe("workload policy", () => {
  it("returns a bounded XS-XL estimate with a token range and intake confidence", () => {
    const estimate = estimateWorkload({
      phase: "intake",
      mode: "feature",
      scope: { code: true, ui: true, api: false },
      signals: { requirements: 3, uiSurfaces: 1, testTargets: 1, uncertainty: 3 },
    });

    expect(["XS", "S", "M", "L", "XL"]).toContain(estimate.size);
    expect(estimate.tokenRange.min).toBeGreaterThan(0);
    expect(estimate.tokenRange.max).toBeGreaterThan(estimate.tokenRange.min);
    expect(estimate.confidence).toBe("low");
    expect(estimate.budget.checkpointAtTokens).toBe(
      Math.floor(estimate.budget.hardLimitTokens * 0.8),
    );
    expect(WorkloadEstimateSchema.parse(estimate)).toEqual(estimate);
  });

  it("never classifies a larger observed workload below a smaller one", () => {
    const sizes = ["XS", "S", "M", "L", "XL"];
    const small = estimateWorkload({
      phase: "contracts",
      mode: "auto",
      scope: { code: true, ui: false, api: false },
      signals: { requirements: 1, relevantFiles: 1, testTargets: 1, uncertainty: 0 },
    });
    const large = estimateWorkload({
      phase: "contracts",
      mode: "auto",
      scope: { code: true, ui: true, api: true },
      signals: {
        requirements: 20,
        relevantFiles: 40,
        apiOperations: 12,
        uiSurfaces: 10,
        figmaNodes: 80,
        testTargets: 15,
        uncertainty: 0,
      },
    });

    expect(sizes.indexOf(large.size)).toBeGreaterThan(sizes.indexOf(small.size));
    expect(large.tokenRange.min).toBeGreaterThanOrEqual(small.tokenRange.min);
    expect(large.confidence).toBe("high");
  });

  it("accepts only non-negative numeric workload signals", () => {
    expect(WorkloadSignalsSchema.safeParse({}).success).toBe(false);
    expect(WorkloadSignalsSchema.safeParse({ uncertainty: 2 }).success).toBe(false);
    expect(WorkloadSignalsSchema.safeParse({ relevantFiles: -1 }).success).toBe(false);
    expect(WorkloadSignalsSchema.safeParse({ requirements: 2, prompt: "secret" }).success).toBe(
      false,
    );
  });

  it("keeps confidence low when contract evidence has sparse coverage or uncertainty", () => {
    expect(
      estimateWorkload({
        phase: "contracts",
        mode: "auto",
        scope: { code: true, ui: false, api: false },
        signals: { requirements: 2, uncertainty: 4 },
      }).confidence,
    ).toBe("low");
    expect(
      estimateWorkload({
        phase: "contracts",
        mode: "auto",
        scope: { code: true, ui: false, api: false },
        signals: { requirements: 2, relevantFiles: 3, testTargets: 1, uncertainty: 1 },
      }).confidence,
    ).toBe("medium");
  });
});
