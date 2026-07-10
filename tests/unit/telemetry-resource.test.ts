import { describe, expect, it } from "vitest";

import { toOpenTelemetryResourceAttributes } from "../../src/observability/telemetry-resource.js";

describe("telemetry resource", () => {
  it("renders OpenTelemetry resource attributes", () => {
    const result = toOpenTelemetryResourceAttributes({
      serviceName: "spec-to-pr-plugin",
      serviceVersion: "0.1.0",
      serviceNamespace: "spec-to-pr",
      deploymentEnvironment: "test",
    });

    expect(result).toMatchObject({
      "service.name": "spec-to-pr-plugin",
      "service.version": "0.1.0",
      "service.namespace": "spec-to-pr",
      "deployment.environment.name": "test",
    });
  });
});
