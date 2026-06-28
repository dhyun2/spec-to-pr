import { describe, expect, it } from "vitest";

import {
  createDefaultObservabilityPlan,
  detectObservabilityGaps,
} from "../../src/observability/telemetry-plan.js";

describe("observability plan", () => {
  it("creates console exporter plan by default", () => {
    const plan = createDefaultObservabilityPlan({
      target: "both",
      serviceName: "app",
      serviceVersion: "1.0.0",
    });

    expect(plan.exporter).toBe("console");
    expect(plan.enableLogCorrelation).toBe(true);
    expect(plan.enableOtelLogs).toBe(false);
  });

  it("detects missing collector for otlp exporter", () => {
    const plan = {
      ...createDefaultObservabilityPlan({
        target: "target-app",
        serviceName: "app",
        serviceVersion: "1.0.0",
      }),
      exporter: "otlp-http" as const,
    };

    const gaps = detectObservabilityGaps(plan);

    expect(gaps.some((gap) => gap.title.includes("Collector URL"))).toBe(true);
  });
});
