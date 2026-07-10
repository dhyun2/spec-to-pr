import { describe, expect, it } from "vitest";

import { renderObservabilityConfig } from "../../src/observability/telemetry-config-renderer.js";
import { createDefaultObservabilityPlan } from "../../src/observability/telemetry-plan.js";

describe("observability config renderer", () => {
  it("renders node otel config and log correlation helper", () => {
    const rendered = renderObservabilityConfig(
      createDefaultObservabilityPlan({
        target: "target-app",
        serviceName: "rangepro",
        serviceVersion: "1.0.0",
      }),
    );

    expect(rendered.otelNodeTs).toContain("NodeSDK");
    expect(rendered.loggerCorrelationTs).toContain("trace_id");
    expect(rendered.apiWrapperSpanTemplateTs).toContain("withApiWrapperSpan");
  });
});
