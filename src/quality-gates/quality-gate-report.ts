import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  CoverageMetricSchema,
  CoverageSummarySchema,
  QualityGateReportSchema,
} from "./quality-gate-model.js";
import type { CoverageSummary, QualityGateReport } from "./quality-gate-model.js";

export async function readCoverageSummary(input: {
  projectRoot: string;
  relativePath: string;
}): Promise<{ coverageSummary?: CoverageSummary; warning?: string }> {
  const absolutePath = path.join(input.projectRoot, input.relativePath);

  try {
    const parsed = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
    const total = totalCoverageObject(parsed);

    if (total === undefined) {
      return {
        warning: `Coverage summary did not contain total coverage metrics: ${input.relativePath}`,
      };
    }

    return {
      coverageSummary: CoverageSummarySchema.parse({
        path: input.relativePath,
        lines: metric(total["lines"]),
        statements: metric(total["statements"]),
        functions: metric(total["functions"]),
        branches: metric(total["branches"]),
      }),
    };
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      return {};
    }

    return {
      warning: `Coverage summary could not be read: ${input.relativePath}`,
    };
  }
}

export function renderQualityGateReportMarkdown(rawReport: QualityGateReport): string {
  const report = QualityGateReportSchema.parse(rawReport);
  const lines = [
    "# Quality Gate Report",
    "",
    `- Status: ${report.status}`,
    `- Gates: ${report.gateCount}`,
    `- Passed: ${report.passedCount}`,
    `- Failed: ${report.failedCount}`,
    `- Skipped: ${report.skippedCount}`,
    `- Package manager: ${report.packageManager}`,
    "",
    "## Checks",
    "",
    "| Gate | Kind | Status | Command | Summary |",
    "| --- | --- | --- | --- | --- |",
    ...report.checks.map(
      (check) =>
        `| ${escapeMarkdown(check.name)} | ${check.kind} | ${check.status} | ${escapeMarkdown(
          check.command ?? "",
        )} | ${escapeMarkdown(check.summary)} |`,
    ),
  ];

  if (report.coverageSummary !== undefined) {
    lines.push(
      "",
      "## Coverage",
      "",
      "| Metric | Covered | Total | Pct |",
      "| --- | ---: | ---: | ---: |",
      coverageMetricLine("Lines", report.coverageSummary.lines),
      coverageMetricLine("Statements", report.coverageSummary.statements),
      coverageMetricLine("Functions", report.coverageSummary.functions),
      coverageMetricLine("Branches", report.coverageSummary.branches),
    );
  }

  if (report.warnings.length > 0) {
    lines.push("", "## Warnings", "", ...report.warnings.map((warning) => `- ${warning}`));
  }

  return `${lines.join("\n")}\n`;
}

function totalCoverageObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const total = (value as Record<string, unknown>)["total"];

  if (typeof total !== "object" || total === null || Array.isArray(total)) {
    return undefined;
  }

  return total as Record<string, unknown>;
}

function metric(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return CoverageMetricSchema.parse({
      total: 0,
      covered: 0,
      skipped: 0,
      pct: 0,
    });
  }

  const object = value as Record<string, unknown>;

  return CoverageMetricSchema.parse({
    total: integerValue(object["total"]),
    covered: integerValue(object["covered"]),
    skipped: integerValue(object["skipped"]),
    pct: numberValue(object["pct"]),
  });
}

function integerValue(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function coverageMetricLine(name: string, metric: { covered: number; total: number; pct: number }) {
  return `| ${name} | ${metric.covered} | ${metric.total} | ${metric.pct} |`;
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as { code?: unknown }).code === "ENOENT"
  );
}
