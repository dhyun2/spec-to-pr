import { z } from "zod";

import type { BundleBudget } from "./performance-budget.js";
import type { PerformancePlan } from "./performance-model.js";

export const LighthouseCiConfigSchema = z
  .object({
    ci: z
      .object({
        collect: z.record(z.string(), z.unknown()),
        assert: z.record(z.string(), z.unknown()),
        upload: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();

export type LighthouseCiConfig = z.infer<typeof LighthouseCiConfigSchema>;

export function createLighthouseCiConfig(input: {
  plan: PerformancePlan;
  budget: BundleBudget;
}): LighthouseCiConfig {
  const urls = input.plan.routes.map((route) => `${input.plan.baseUrl}${route.urlPath}`);

  return LighthouseCiConfigSchema.parse({
    ci: {
      collect: {
        url: urls,
        numberOfRuns: input.plan.repeats,
        settings: {
          preset: "desktop",
        },
      },
      assert: {
        assertions: {
          "largest-contentful-paint": ["warn", { maxNumericValue: input.plan.thresholds.lcpMs }],
          "cumulative-layout-shift": ["warn", { maxNumericValue: input.plan.thresholds.cls }],
          "total-blocking-time": ["warn", { maxNumericValue: input.plan.thresholds.tbtMs }],
          "categories:performance": ["warn", { minScore: 0.8 }],
        },
      },
    },
  });
}
