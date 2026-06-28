import type {
  GherkinBundle,
  GherkinFeature,
  GherkinScenario,
  GherkinStep,
} from "./gherkin-model.js";
import type { TestMatrix, TestMatrixRow } from "./test-matrix.js";

export type RenderedGherkinArtifacts = {
  featureFiles: Array<{
    fileName: string;
    content: string;
  }>;
  gherkinIndexJson: string;
  testMatrixJson: string;
  testMatrixMd: string;
};

export function renderGherkinArtifacts(input: {
  bundle: GherkinBundle;
  matrix: TestMatrix;
}): RenderedGherkinArtifacts {
  return {
    featureFiles: input.bundle.features.map((feature) => ({
      fileName: `${feature.area}.feature`,
      content: renderFeature(feature),
    })),
    gherkinIndexJson: `${JSON.stringify(input.bundle, null, 2)}\n`,
    testMatrixJson: `${JSON.stringify(input.matrix, null, 2)}\n`,
    testMatrixMd: renderTestMatrixMarkdown(input.matrix),
  };
}

function renderFeature(feature: GherkinFeature): string {
  const lines: string[] = [];

  lines.push(...feature.tags);
  lines.push(`Feature: ${feature.name}`);

  if (feature.description !== undefined) {
    lines.push("");
    lines.push(indent(feature.description, 2));
  }

  for (const rule of feature.rules) {
    lines.push("");
    lines.push(`  Rule: ${rule.name}`);

    if (rule.description !== undefined) {
      lines.push("");
      lines.push(indent(rule.description, 4));
    }

    for (const scenario of rule.scenarios) {
      lines.push("");
      lines.push(renderScenario(scenario));
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function renderScenario(scenario: GherkinScenario): string {
  const lines: string[] = [];

  if (scenario.tags.length > 0) {
    lines.push(`    ${scenario.tags.join(" ")}`);
  }

  lines.push(`    Scenario: ${scenario.name}`);

  for (const step of scenario.steps) {
    lines.push(renderStep(step));
  }

  return lines.join("\n");
}

function renderStep(step: GherkinStep): string {
  return `      ${step.keyword} ${step.text}`;
}

function renderTestMatrixMarkdown(matrix: TestMatrix): string {
  const lines: string[] = [
    `# Test Matrix — ${matrix.changeName}`,
    "",
    "## Summary",
    "",
    `- Requirements: ${matrix.requirementCount}`,
    `- Scenarios: ${matrix.scenarioCount}`,
    `- Automated candidates: ${matrix.automatedCandidateCount}`,
    `- Review needed: ${matrix.reviewNeededCount}`,
    `- Blocked: ${matrix.blockedCount}`,
    "",
    "## Matrix",
    "",
    "| Requirement | Scenario | Area | Layer | Automation | Status | Brief | Figma | API | Gaps | Reason |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...matrix.rows.map(renderMatrixRow),
    "",
  ];

  return `${lines.join("\n").trimEnd()}\n`;
}

function renderMatrixRow(row: TestMatrixRow): string {
  return [
    row.requirementId,
    row.scenarioId,
    row.area,
    row.layer,
    row.automation,
    row.status,
    joinIds(row.briefEvidenceIds),
    joinIds(row.figmaEvidenceIds),
    joinIds(row.openApiEvidenceIds),
    joinIds(row.gapIds),
    escapeTableCell(row.reason),
  ].join(" | ");
}

function joinIds(ids: string[]): string {
  return ids.length === 0 ? "-" : ids.join("<br>");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function indent(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);

  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
