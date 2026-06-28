import { describe, expect, it } from "vitest";

import {
  AccessibilityReportSchema,
  ManualAccessibilityReviewItemSchema,
} from "../../src/accessibility/accessibility-model.js";

describe("accessibility model", () => {
  it("keeps automated checks and manual review items separate", () => {
    const manual = ManualAccessibilityReviewItemSchema.parse({
      id: "manual-screen-reader-reservation-list",
      targetId: "reservation-list",
      topic: "screen-reader-flow",
      status: "required",
      reason: "Automated checks cannot prove full screen reader task flow.",
    });
    const report = AccessibilityReportSchema.parse({
      adapter: "accessibility-gate-v1",
      runId: "run_11111111111111111111111111111111",
      generatedAt: "2026-06-23T00:00:00.000Z",
      targets: [],
      automatedChecks: [],
      keyboardChecks: [],
      focusChecks: [],
      manualReviewItems: [manual],
      gapIds: [],
      artifactIds: [],
      decision: "review-needed",
      summary: "Manual review is required.",
    });

    expect(report.manualReviewItems).toHaveLength(1);
    expect(report.decision).toBe("review-needed");
  });
});
