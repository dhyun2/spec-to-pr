import { describe, expect, it } from "vitest";

import { detectWebVitalsReadiness } from "../../src/performance/web-vitals-readiness.js";

describe("web vitals readiness", () => {
  it("detects ready instrumentation", () => {
    const report = detectWebVitalsReadiness({
      packageJson: {
        dependencies: {
          "web-vitals": "^5.0.0",
        },
      },
      sourceTexts: [
        {
          path: "src/report-web-vitals.ts",
          content: `
            import { onLCP, onINP, onCLS } from 'web-vitals';

            export function reportWebVitals() {
              onLCP(sendToAnalytics);
              onINP(sendToAnalytics);
              onCLS(sendToAnalytics);
              const release = process.env.APP_VERSION;
              const sanitized = redact(window.location.href);
              return sanitized;
            }
          `,
        },
      ],
    });

    expect(report.status).toBe("ready");
  });

  it("detects missing instrumentation", () => {
    const report = detectWebVitalsReadiness({
      packageJson: {
        dependencies: {},
      },
      sourceTexts: [],
    });

    expect(report.status).toBe("missing");
  });
});
