import type { AccessibilityReport } from "./accessibility-model.js";

export function renderAccessibilityReportMarkdown(report: AccessibilityReport): string {
  const lines = [
    "# Accessibility Gate Report",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Decision: ${report.decision}`,
    `- Targets: ${report.targets.length}`,
    `- Automated checks: ${report.automatedChecks.length}`,
    `- Manual review items: ${report.manualReviewItems.length}`,
    `- Gaps: ${report.gapIds.length}`,
    "",
    report.summary,
    "",
    "## Automated Checks",
    "",
    "| Target | Status | Violations | Critical | Serious | Moderate | Minor |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...report.automatedChecks.map((check) =>
      [
        check.targetId,
        check.status,
        check.violationCount,
        check.criticalCount,
        check.seriousCount,
        check.moderateCount,
        check.minorCount,
      ].join(" | "),
    ),
    "",
    "## Manual Review",
    "",
    "| Target | Topic | Status | Reason |",
    "| --- | --- | --- | --- |",
    ...report.manualReviewItems.map((item) =>
      [item.targetId, item.topic, item.status, item.reason.replaceAll("|", "\\|")].join(" | "),
    ),
    "",
  ];

  return `${lines.join("\n").trimEnd()}\n`;
}
