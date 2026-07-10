import { describe, expect, it } from "vitest";

import { inferAutomationStatus, inferTestLayer } from "../../src/gherkin/test-matrix.js";

describe("test matrix policy", () => {
  it("infers conservative test layers from evidence and requirement text", () => {
    expect(
      inferTestLayer({
        hasFigma: true,
        hasOpenApi: true,
        hasGaps: false,
        requirementText: "예약 목록 조회",
      }),
    ).toBe("acceptance");

    expect(
      inferTestLayer({
        hasFigma: false,
        hasOpenApi: true,
        hasGaps: false,
        requirementText: "GET API response schema",
      }),
    ).toBe("contract");

    expect(
      inferTestLayer({
        hasFigma: false,
        hasOpenApi: false,
        hasGaps: false,
        requirementText: "상태 정책 검증",
      }),
    ).toBe("unit");

    expect(
      inferTestLayer({
        hasFigma: true,
        hasOpenApi: true,
        hasGaps: true,
        requirementText: "예약 목록 조회",
      }),
    ).toBe("manual");
  });

  it("infers automation readiness from requirement status and gaps", () => {
    expect(
      inferAutomationStatus({
        requirementStatus: "ready",
        hasGaps: false,
        hasBlockerGap: false,
      }),
    ).toBe("automated-candidate");

    expect(
      inferAutomationStatus({
        requirementStatus: "partial",
        hasGaps: false,
        hasBlockerGap: false,
      }),
    ).toBe("review-needed");

    expect(
      inferAutomationStatus({
        requirementStatus: "ready",
        hasGaps: true,
        hasBlockerGap: true,
      }),
    ).toBe("blocked");

    expect(
      inferAutomationStatus({
        requirementStatus: "gap-only",
        hasGaps: false,
        hasBlockerGap: false,
      }),
    ).toBe("manual");
  });
});
