import { describe, expect, it } from "vitest";

import { normalizeAxeResult } from "../../src/accessibility/axe-result-normalizer.js";

describe("axe result normalizer", () => {
  it("normalizes axe violations", () => {
    const result = normalizeAxeResult({
      targetId: "reservation-list",
      rawResult: {
        violations: [
          {
            id: "button-name",
            impact: "serious",
            help: "Buttons must have discernible text",
            tags: ["wcag2a", "wcag412"],
            nodes: [
              {
                target: ["button.icon-only"],
                html: "<button></button>",
                failureSummary: "Element has no accessible name",
              },
            ],
          },
        ],
      },
    });

    expect(result.status).toBe("failed");
    expect(result.seriousCount).toBe(1);
    expect(result.violations[0]!.id).toBe("button-name");
    expect(result.violations[0]!.wcagTags).toEqual(["wcag2a", "wcag412"]);
  });

  it("passes when no violations exist", () => {
    const result = normalizeAxeResult({
      targetId: "reservation-list",
      rawResult: {
        violations: [],
      },
    });

    expect(result.status).toBe("passed");
    expect(result.violationCount).toBe(0);
  });
});
