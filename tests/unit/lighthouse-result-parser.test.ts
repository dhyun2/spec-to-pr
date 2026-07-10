import { describe, expect, it } from "vitest";

import { parseLighthouseReports } from "../../src/performance/lighthouse-result-parser.js";

describe("lighthouse result parser", () => {
  it("extracts core lab metrics", () => {
    const summary = parseLighthouseReports([
      {
        requestedUrl: "http://localhost:3000/reservations",
        categories: {
          performance: {
            score: 0.91,
          },
        },
        audits: {
          "largest-contentful-paint": {
            numericValue: 2100,
          },
          "cumulative-layout-shift": {
            numericValue: 0.04,
          },
          "total-blocking-time": {
            numericValue: 120,
          },
          "first-contentful-paint": {
            numericValue: 900,
          },
          "speed-index": {
            numericValue: 1600,
          },
        },
      },
    ]);

    expect(summary.metrics[0]).toMatchObject({
      lcpMs: 2100,
      cls: 0.04,
      tbtMs: 120,
    });
  });
});
