import type { VisualReport } from "./visual-model.js";

export function renderVisualReportMarkdown(report: VisualReport): string {
  const lines = [
    "# Visual Regression Report",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Change: ${report.changeName}`,
    `- Targets: ${report.targetCount}`,
    `- Passed: ${report.passedCount}`,
    `- Failed: ${report.failedCount}`,
    `- Review needed: ${report.reviewNeededCount}`,
    "",
    "## Results",
    "",
    "| Target | Status | Exact | Review | Figma | Browser | Diff | Overlay | Gaps |",
    "| --- | --- | ---: | ---: | --- | --- | --- | --- | --- |",
    ...report.results.map((result) =>
      [
        result.targetId,
        result.status,
        `${(result.metrics.exactMatchRatio * 100).toFixed(2)}%`,
        `${(result.metrics.reviewMatchRatio * 100).toFixed(2)}%`,
        result.figmaScreenshotArtifactId,
        result.browserScreenshotArtifactId,
        result.diffArtifactId ?? "-",
        result.overlayArtifactId ?? "-",
        result.gapIds.length === 0 ? "-" : result.gapIds.join("<br>"),
      ].join(" | "),
    ),
    "",
  ];

  return `${lines.join("\n").trimEnd()}\n`;
}
