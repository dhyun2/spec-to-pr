import type { PrReportViewModel } from "./pr-report-model.js";
import { markdownTable } from "./markdown-table.js";

export function renderPrReportMarkdown(model: PrReportViewModel): string {
  return `${[
    renderSummary(model),
    renderRunMetadata(model),
    renderReviewGuide(model),
    renderSpecification(model),
    renderRequirementTraceability(model),
    renderChangeScope(model),
    renderApi(model),
    renderFunctional(model),
    renderDesign(model),
    renderVisual(model),
    renderScreenshotCompare(),
    renderNetworkVerification(),
    renderAccessibility(model),
    renderPerformance(model),
    renderObservability(model),
    renderRuntimeVerification(model),
    renderGaps(model),
    renderArchivePlan(model),
    renderDecision(model),
  ]
    .join("\n\n")
    .trimEnd()}\n`;
}

function renderSummary(model: PrReportViewModel): string {
  return ["# Summary", "", ...model.summaryBullets.map((item) => `- ${item}`)].join("\n");
}

function renderRunMetadata(model: PrReportViewModel): string {
  return [
    "## Run Metadata",
    "",
    markdownTable(
      ["Item", "Value"],
      Object.entries(model.runMetadata).map(([key, value]) => [key, value]),
    ),
  ].join("\n");
}

function renderReviewGuide(model: PrReportViewModel): string {
  return ["## Review Guide", "", ...model.reviewGuide.map((item) => `- ${item}`)].join("\n");
}

function renderSpecification(model: PrReportViewModel): string {
  return [
    "## Specification",
    "",
    model.specificationLinks.length === 0
      ? "No OpenSpec artifacts were found."
      : markdownTable(
          ["Artifact", "URI"],
          model.specificationLinks.map((link) => [link.label, link.uri]),
        ),
  ].join("\n");
}

function renderRequirementTraceability(model: PrReportViewModel): string {
  return [
    "## Requirement Traceability",
    "",
    model.traceabilityRows.length === 0
      ? "No traceability matrix rows were found."
      : markdownTable(
          ["Requirement", "Status", "Brief", "Figma", "API", "Scenarios", "Gaps"],
          model.traceabilityRows.map((row) => [
            `${row.requirementId}<br>${row.title}`,
            row.status,
            row.briefEvidence.join("<br>") || "-",
            row.figmaEvidence.join("<br>") || "-",
            row.openApiEvidence.join("<br>") || "-",
            row.scenarios.join("<br>") || "-",
            row.gaps.join("<br>") || "-",
          ]),
        ),
  ].join("\n");
}

function renderChangeScope(model: PrReportViewModel): string {
  return [
    "## Change Scope",
    "",
    model.changeScopeRows.length === 0
      ? "No change scope rows were found."
      : markdownTable(
          ["Area", "Artifact Count", "Review Focus"],
          model.changeScopeRows.map((row) => [
            row["Area"] ?? "-",
            row["Artifact Count"] ?? "-",
            row["Review Focus"] ?? "-",
          ]),
        ),
  ].join("\n");
}

function renderApi(model: PrReportViewModel): string {
  return [
    "## API Generator / API Contract",
    "",
    model.apiRows.length === 0
      ? "No API artifacts were found."
      : markdownTable(
          ["Artifact", "Kind", "URI", "Digest"],
          model.apiRows.map((row) => [
            row["Artifact"] ?? "-",
            row["Kind"] ?? "-",
            row["URI"] ?? "-",
            row["Digest"] ?? "-",
          ]),
        ),
  ].join("\n");
}

function renderFunctional(model: PrReportViewModel): string {
  return renderCheckSection("## Functional Verification", model.functionalChecks);
}

function renderDesign(model: PrReportViewModel): string {
  return renderCheckSection("## Design Contract", model.designChecks);
}

function renderVisual(model: PrReportViewModel): string {
  return [
    "## Visual Regression",
    "",
    model.visualRows.length === 0
      ? "No visual comparison rows were found."
      : markdownTable(
          ["State", "Exact", "Review Match", "Result", "Notes"],
          model.visualRows.map((row) => [
            row.state,
            row.exactMatch === undefined ? "-" : `${row.exactMatch.toFixed(2)}%`,
            row.reviewMatch === undefined ? "-" : `${row.reviewMatch.toFixed(2)}%`,
            row.result,
            row.notes ?? "-",
          ]),
        ),
    "",
    "Visual match rates must be interpreted with the comparison algorithm, threshold, masks, viewport, browser, and font environment recorded in the visual report artifact.",
  ].join("\n");
}

function renderScreenshotCompare(): string {
  return [
    "## Screenshot Compare",
    "",
    "Screenshot comparison evidence is reported through the Visual Regression section and linked visual-report artifacts. A missing visual report must not be treated as Pass.",
  ].join("\n");
}

function renderNetworkVerification(): string {
  return [
    "## Network Verification",
    "",
    "Network verification must be backed by explicit CheckResult or API contract artifacts. Fixture-backed smoke tests are not live API verification.",
  ].join("\n");
}

function renderAccessibility(model: PrReportViewModel): string {
  return [
    renderCheckSection("## Accessibility", model.accessibilityChecks),
    "",
    "Automated accessibility checks do not prove manual screen-reader review unless a manual review artifact exists.",
  ].join("\n");
}

function renderPerformance(model: PrReportViewModel): string {
  return [
    "## Performance / Web Vitals",
    "",
    model.performanceRows.length === 0
      ? "No performance rows were found."
      : markdownTable(
          ["Metric", "Value", "Budget", "Result", "Source"],
          model.performanceRows.map((row) => [
            row.metric,
            row.value,
            row.budget ?? "-",
            row.result,
            row.source,
          ]),
        ),
    "",
    "Lighthouse and CI measurements are lab data. Field Web Vitals require real-user monitoring or field data artifacts.",
  ].join("\n");
}

function renderObservability(model: PrReportViewModel): string {
  return [
    renderCheckSection("## OpenTelemetry / Observability", model.observabilityChecks),
    "",
    "OpenTelemetry templates and log correlation artifacts do not prove collector deployment or production telemetry collection.",
  ].join("\n");
}

function renderRuntimeVerification(model: PrReportViewModel): string {
  return renderCheckSection("## Runtime / Verification", model.runtimeChecks);
}

function renderGaps(model: PrReportViewModel): string {
  return [
    "## Gaps And Review Notes",
    "",
    model.gapSummaries.length === 0
      ? "No open or assumed gaps were found."
      : markdownTable(
          ["Gap", "Category", "Severity", "Status", "Title", "Impact"],
          model.gapSummaries.map((gap) => [
            gap.id,
            gap.category,
            gap.severity,
            gap.status,
            gap.title,
            gap.impact,
          ]),
        ),
  ].join("\n");
}

function renderArchivePlan(model: PrReportViewModel): string {
  return ["## OpenSpec Archive Plan", "", ...model.archivePlan.map((item) => `- ${item}`)].join(
    "\n",
  );
}

function renderDecision(model: PrReportViewModel): string {
  return [
    "## Decision",
    "",
    markdownTable(
      ["Item", "Result"],
      [
        ["Merge readiness", model.decision],
        ["Report generated at", model.generatedAt],
        ["Run ID", model.runId],
      ],
    ),
  ].join("\n");
}

function renderCheckSection(title: string, checks: PrReportViewModel["functionalChecks"]): string {
  return [
    title,
    "",
    checks.length === 0
      ? "No check results were found for this section."
      : markdownTable(
          ["Check", "Kind", "Result", "Command", "Exit Code", "Summary"],
          checks.map((check) => [
            check.name,
            check.kind,
            check.status,
            check.command ?? "-",
            check.exitCode === undefined ? "-" : String(check.exitCode),
            check.summary,
          ]),
        ),
  ].join("\n");
}
