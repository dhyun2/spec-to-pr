import type { Gap } from "../runtime/gap.js";
import type { LighthouseSummary } from "./lighthouse-result-parser.js";
import type { BudgetCheckResult } from "./performance-budget.js";
import type { PerformancePlan } from "./performance-model.js";
import type { WebVitalsReadinessReport } from "./web-vitals-readiness.js";

export function renderPerformanceReport(input: {
  plan: PerformancePlan;
  lighthouse: LighthouseSummary;
  budget: BudgetCheckResult;
  webVitals: WebVitalsReadinessReport;
  gaps: Gap[];
}): string {
  const lines = [
    "# Performance and Web Vitals Report",
    "",
    "## Summary",
    "",
    `- Routes measured: ${input.plan.routes.length}`,
    `- Lighthouse runs per route: ${input.plan.repeats}`,
    `- Budget passed: ${input.budget.passed ? "Yes" : "No"}`,
    `- Web Vitals readiness: ${input.webVitals.status}`,
    `- Performance gaps: ${input.gaps.length}`,
    "",
    "## Lighthouse Lab Metrics",
    "",
    "| URL | Performance | LCP ms | CLS | TBT ms | FCP ms | Speed Index ms |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...input.lighthouse.metrics.map(
      (metric) =>
        `| ${metric.url} | ${metric.performanceScore ?? "-"} | ${metric.lcpMs ?? "-"} | ${metric.cls ?? "-"} | ${metric.tbtMs ?? "-"} | ${metric.fcpMs ?? "-"} | ${metric.speedIndexMs ?? "-"} |`,
    ),
    "",
    "## Bundle and Asset Budget",
    "",
    input.budget.passed ? "All configured budgets passed." : "Some budgets failed.",
    "",
    ...input.budget.failures.map(
      (failure) =>
        `- ${failure.kind}: ${failure.observedBytes} bytes observed, budget ${failure.budgetBytes}. ${failure.message}`,
    ),
    "",
    "## Web Vitals Field Readiness",
    "",
    `Status: ${input.webVitals.status}`,
    "",
    `- web-vitals dependency: ${yesNo(input.webVitals.hasWebVitalsDependency)}`,
    `- LCP instrumentation: ${yesNo(input.webVitals.hasLcpInstrumentation)}`,
    `- INP instrumentation: ${yesNo(input.webVitals.hasInpInstrumentation)}`,
    `- CLS instrumentation: ${yesNo(input.webVitals.hasClsInstrumentation)}`,
    `- Analytics sink: ${yesNo(input.webVitals.hasAnalyticsSink)}`,
    `- Release metadata: ${yesNo(input.webVitals.hasReleaseMetadata)}`,
    `- Redaction policy: ${yesNo(input.webVitals.hasRedactionPolicy)}`,
    "",
    "## Important Caveat",
    "",
    "Lighthouse results are lab data. Do not report them as field Web Vitals. Field Web Vitals require RUM or CrUX artifacts.",
    "",
    "## Gaps",
    "",
    ...(input.gaps.length === 0
      ? ["No performance gaps were created."]
      : input.gaps.map((gap) => `- ${gap.id}: ${gap.title} (${gap.severity})`)),
    "",
  ];

  return `${lines.join("\n").trimEnd()}\n`;
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}
