import { describe, expect, it } from "vitest";

import { mapAccessibilityChecksToGaps } from "../../src/accessibility/accessibility-gap-mapper.js";

describe("accessibility gap mapper", () => {
  it("maps serious violations to major gaps", () => {
    const gaps = mapAccessibilityChecksToGaps({
      createdAt: "2026-06-23T00:00:00.000Z",
      checks: [
        {
          id: "axe-reservation",
          targetId: "reservation",
          engine: "axe-core",
          status: "failed",
          violationCount: 1,
          criticalCount: 0,
          seriousCount: 1,
          moderateCount: 0,
          minorCount: 0,
          violations: [
            {
              id: "button-name",
              impact: "serious",
              help: "Buttons must have discernible text",
              target: ["button"],
              wcagTags: ["wcag2a"],
            },
          ],
          evidenceIds: [],
          summary: "1 violation",
        },
      ],
    });

    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.category).toBe("accessibility");
    expect(gaps[0]!.severity).toBe("major");
  });
});
