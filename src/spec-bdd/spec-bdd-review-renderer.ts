import type { SpecBddReviewReport } from "./spec-bdd-contracts.js";

export function renderSpecBddReviewMarkdown(report: SpecBddReviewReport): string {
  const lines = [
    `# Spec/BDD Review - ${report.changeName}`,
    "",
    "## Summary",
    "",
    `- Status: ${report.status}`,
    `- Reviewed requirements: ${report.reviewedRequirements}`,
    `- Reviewed scenarios: ${report.reviewedScenarios}`,
    `- Acceptance skeletons: ${report.acceptanceSkeletonCount}`,
    `- Findings: ${report.findings.length}`,
    "",
    "## Findings",
    "",
    ...(report.findings.length === 0
      ? ["No findings."]
      : [
          "| Severity | Category | Requirement | Scenario | Title | Recommendation |",
          "|---|---|---|---|---|---|",
          ...report.findings.map((finding) =>
            [
              finding.severity,
              finding.category,
              finding.requirementId ?? "-",
              finding.scenarioId ?? "-",
              escapeCell(finding.title),
              escapeCell(finding.recommendation),
            ].join(" | "),
          ),
        ]),
    "",
    "## Artifact IDs",
    "",
    ...(report.artifactIds.length === 0
      ? ["No artifacts recorded yet."]
      : report.artifactIds.map((id) => `- ${id}`)),
    "",
  ];

  return `${lines.join("\n").trimEnd()}\n`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
