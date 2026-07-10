import { describe, expect, it } from "vitest";

import {
  REDACTED,
  redactTelemetryAttributes,
} from "../../src/observability/telemetry-redaction.js";

describe("telemetry redaction", () => {
  it("redacts secret-like keys", () => {
    const result = redactTelemetryAttributes({
      "http.request.header.authorization": "Bearer secret",
      "spec_to_pr.run.id": "run_abc",
    });

    expect(result["http.request.header.authorization"]).toBe(REDACTED);
    expect(result["spec_to_pr.run.id"]).toBe("run_abc");
  });

  it("redacts secret-like values", () => {
    const result = redactTelemetryAttributes({
      "error.message": "failed with token sk-123456789012345678901234",
    });

    expect(result["error.message"]).toBe(REDACTED);
  });
});
