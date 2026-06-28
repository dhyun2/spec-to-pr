import { describe, expect, it } from "vitest";

import { checkBundleBudget } from "../../src/performance/bundle-budget-checker.js";

describe("bundle budget checker", () => {
  it("passes when assets fit budgets", () => {
    const result = checkBundleBudget({
      assets: [
        {
          path: "main.js",
          type: "script",
          transferBytes: 100_000,
          initial: true,
        },
      ],
      budget: {
        maxInitialJsBytes: 300_000,
        maxInitialCssBytes: 100_000,
        maxImageBytes: 500_000,
        maxFontBytes: 200_000,
        resources: [],
      },
    });

    expect(result.passed).toBe(true);
  });

  it("fails when initial JS exceeds budget", () => {
    const result = checkBundleBudget({
      assets: [
        {
          path: "main.js",
          type: "script",
          transferBytes: 400_000,
          initial: true,
        },
      ],
      budget: {
        maxInitialJsBytes: 300_000,
        maxInitialCssBytes: 100_000,
        maxImageBytes: 500_000,
        maxFontBytes: 200_000,
        resources: [],
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures[0]!.kind).toBe("initial-js");
  });
});
