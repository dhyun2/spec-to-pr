import { GapSchema, type Gap } from "../runtime/gap.js";
import { createGapId } from "../runtime/id-factory.js";
import type { LighthouseSummary } from "./lighthouse-result-parser.js";
import type { BudgetCheckResult } from "./performance-budget.js";
import type { CoreWebVitalsThresholds } from "./performance-model.js";
import type { WebVitalsReadinessReport } from "./web-vitals-readiness.js";

export function mapPerformanceGaps(input: {
  lighthouse: LighthouseSummary;
  thresholds: CoreWebVitalsThresholds;
  budget: BudgetCheckResult;
  webVitals: WebVitalsReadinessReport;
  timestamp: string;
}): Gap[] {
  const gaps: Gap[] = [];

  for (const metric of input.lighthouse.metrics) {
    if (metric.lcpMs !== null && metric.lcpMs > input.thresholds.lcpMs) {
      gaps.push(
        createPerformanceGap({
          title: `LCP exceeds threshold for ${metric.url}`,
          expected: `LCP should be <= ${input.thresholds.lcpMs}ms.`,
          observed: `LCP was ${metric.lcpMs}ms.`,
          impact: "Users may experience slow loading on this route.",
          severity: "major",
          timestamp: input.timestamp,
        }),
      );
    }

    if (metric.cls !== null && metric.cls > input.thresholds.cls) {
      gaps.push(
        createPerformanceGap({
          title: `CLS exceeds threshold for ${metric.url}`,
          expected: `CLS should be <= ${input.thresholds.cls}.`,
          observed: `CLS was ${metric.cls}.`,
          impact: "Users may experience unexpected layout shifts.",
          severity: "major",
          timestamp: input.timestamp,
        }),
      );
    }

    if (metric.tbtMs !== null && metric.tbtMs > input.thresholds.tbtMs) {
      gaps.push(
        createPerformanceGap({
          title: `TBT exceeds threshold for ${metric.url}`,
          expected: `TBT should be <= ${input.thresholds.tbtMs}ms.`,
          observed: `TBT was ${metric.tbtMs}ms.`,
          impact: "The page may be slow to respond during loading.",
          severity: "minor",
          timestamp: input.timestamp,
        }),
      );
    }
  }

  for (const failure of input.budget.failures) {
    gaps.push(
      createPerformanceGap({
        title: `Performance budget exceeded: ${failure.kind}`,
        expected: `Budget should be <= ${failure.budgetBytes} bytes.`,
        observed: `${failure.observedBytes} bytes were observed.`,
        impact: failure.message,
        severity: "major",
        timestamp: input.timestamp,
      }),
    );
  }

  if (input.webVitals.status === "missing") {
    gaps.push(
      createPerformanceGap({
        title: "Web Vitals instrumentation is missing",
        expected: "The application should be ready to collect LCP, INP, and CLS field data.",
        observed: input.webVitals.notes.join("; "),
        impact: "Production field Web Vitals cannot be collected or correlated to releases.",
        severity: "major",
        timestamp: input.timestamp,
      }),
    );
  }

  return gaps;
}

function createPerformanceGap(input: {
  title: string;
  expected: string;
  observed: string;
  impact: string;
  severity: "blocker" | "major" | "minor" | "info";
  timestamp: string;
}): Gap {
  return GapSchema.parse({
    id: createGapId(),
    category: "performance",
    severity: input.severity,
    status: "open",
    title: input.title,
    expected: input.expected,
    observed: input.observed,
    impact: input.impact,
    sourceEvidenceIds: [],
    owner: "evidence-verifier",
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  });
}
