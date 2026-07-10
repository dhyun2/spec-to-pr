import type { ApiPipelineReport } from "./api-pipeline-contracts.js";

export function renderApiPipelineReportMarkdown(report: ApiPipelineReport): string {
  const lines: string[] = [
    `# API Pipeline Report — ${report.sourceKey}`,
    "",
    "## Summary",
    "",
    `- Mode: ${report.mode}`,
    `- Generator: ${report.generator.generatorName}`,
    `- Operations: ${report.operationCount}`,
    `- Generated operations: ${report.generatedOperationCount}`,
    `- Skipped operations: ${report.skippedOperationCount}`,
    `- Blocked operations: ${report.blockedOperationCount}`,
    `- Generated files: ${report.generatedFiles.length}`,
    `- Warnings: ${report.warnings.length}`,
    "",
    "## Operations",
    "",
    "| Operation | Status | Wrapper | Reason | Gaps |",
    "|---|---|---|---|---|",
    ...report.operations.map((operation) =>
      [
        `${operation.method.toUpperCase()} ${operation.path}`,
        operation.status,
        operation.wrapperName ?? "-",
        escapeTableCell(operation.reason),
        operation.gapIds.length === 0 ? "-" : operation.gapIds.join("<br>"),
      ].join(" | "),
    ),
    "",
    "## Generated Files",
    "",
    "| Kind | Path | Changed | Digest |",
    "|---|---|---|---|",
    ...report.generatedFiles.map((file) =>
      [file.kind, file.path, String(file.changed), file.digest].join(" | "),
    ),
    "",
    "## Warnings",
    "",
    ...(report.warnings.length === 0
      ? ["No warnings."]
      : report.warnings.map((warning) => `- ${warning}`)),
    "",
  ];

  return `${lines.join("\n").trimEnd()}\n`;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
