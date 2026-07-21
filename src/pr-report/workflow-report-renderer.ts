import type { PrReportV2 } from "./pr-report-model.js";
import {
  markdownBullet,
  markdownInline,
  markdownTableCell,
  redactSecretShapes,
} from "./markdown-safe.js";

export interface ReadyWorkflowReportInput {
  runId: string;
  reviewPacket: {
    id: string;
    revision: number;
    baseSha?: string | null;
    headSha?: string | null;
    evidenceDigest: string;
    diffDigest: string;
    changedFiles: readonly string[];
  };
  guidanceTrace: {
    explicit: readonly string[];
    discovered: readonly string[];
    skillHints: readonly string[];
    appliedSkills: readonly string[];
  };
  requirementManifest: readonly {
    id: string;
    title: string;
    acceptanceCriteria: readonly string[];
  }[];
  legacyBaseline?: {
    scope: string;
    checks: readonly {
      status: string;
      command: string;
      resultPath: string;
    }[];
  };
  evidencePaths: readonly string[];
  reviews: readonly {
    kind: "functional-review" | "design-review";
    requirements: readonly {
      id: string;
      verdict: string;
    }[];
    gateResults: readonly {
      id: string;
      status: string;
      evidencePaths: readonly string[];
    }[];
    findings: readonly {
      severity: string;
      title: string;
    }[];
  }[];
  featureVideoPath?: string;
}

export function renderReadyWorkflowReport(input: ReadyWorkflowReportInput): string {
  const verdictFor = (requirementId: string) =>
    input.reviews
      .flatMap((review) => review.requirements)
      .filter((requirement) => requirement.id === requirementId)
      .map((requirement) => requirement.verdict)
      .join(", ");
  const gateLines = input.reviews.flatMap((review) =>
    review.gateResults.map(
      (gate) => `- ${review.kind}/${gate.id}: ${gate.status} (${gate.evidencePaths.join(", ")})`,
    ),
  );
  const riskLines = input.reviews.flatMap((review) =>
    review.findings.map((finding) => `- ${finding.severity}: ${finding.title}`),
  );
  const appliedSkills = uniqueValues([
    ...input.guidanceTrace.skillHints,
    ...input.guidanceTrace.appliedSkills,
  ]);

  return [
    `# SpecToPR Run ${input.runId}`,
    "",
    "## Decision",
    "",
    "Ready for draft review.",
    "",
    "## Review packet",
    "",
    `- ID: ${input.reviewPacket.id}`,
    `- Revision: ${input.reviewPacket.revision}`,
    `- Base: ${input.reviewPacket.baseSha ?? "unavailable"}`,
    `- Head: ${input.reviewPacket.headSha ?? "unavailable"}`,
    `- Evidence digest: ${input.reviewPacket.evidenceDigest}`,
    `- Diff digest: ${input.reviewPacket.diffDigest}`,
    "",
    "## Project guidance",
    "",
    "### Explicit",
    "",
    ...(input.guidanceTrace.explicit.length === 0
      ? ["- None."]
      : input.guidanceTrace.explicit.map((guidancePath) => `- ${markdownListValue(guidancePath)}`)),
    "",
    "### Automatically discovered",
    "",
    ...(input.guidanceTrace.discovered.length === 0
      ? ["- None."]
      : input.guidanceTrace.discovered.map(
          (guidancePath) => `- ${markdownListValue(guidancePath)}`,
        )),
    "",
    "## Applied optional skills",
    "",
    ...(appliedSkills.length === 0 ? ["- None."] : appliedSkills.map((skill) => `- ${skill}`)),
    "",
    "## Requirement traceability",
    "",
    "| Requirement | Acceptance criteria | Review verdict |",
    "| --- | --- | --- |",
    ...input.requirementManifest.map(
      (requirement) =>
        `| ${markdownTableCell(`${requirement.id}: ${requirement.title}`)} | ${markdownTableCell(requirement.acceptanceCriteria.join("\n"))} | ${markdownTableCell(verdictFor(requirement.id))} |`,
    ),
    ...(input.legacyBaseline === undefined
      ? []
      : [
          "",
          "## Focused legacy baseline",
          "",
          `- Scope: ${input.legacyBaseline.scope}`,
          ...input.legacyBaseline.checks.map(
            (check) => `- ${check.status}: \`${check.command}\` → ${check.resultPath}`,
          ),
        ]),
    "",
    "## Changed files",
    "",
    ...(input.reviewPacket.changedFiles.length === 0
      ? ["- No changed files declared."]
      : input.reviewPacket.changedFiles.map((file) => `- ${file}`)),
    "",
    "## Evidence",
    "",
    ...input.evidencePaths.map((evidencePath) => `- ${evidencePath}`),
    "",
    "## Validation gates",
    "",
    ...(gateLines.length === 0 ? ["- No gates recorded."] : gateLines),
    "",
    "## Risks",
    "",
    ...(riskLines.length === 0 ? ["- No known review findings."] : riskLines),
    ...(input.featureVideoPath === undefined
      ? []
      : ["", "## Feature E2E video", "", `- ${input.featureVideoPath}`]),
    "",
  ].join("\n");
}

export function renderPrReportV2Markdown(report: PrReportV2): string {
  const bindingLines =
    report.binding === undefined
      ? ["- Review packet: not created before the blocker"]
      : [
          `- Review packet: ${markdownBullet(report.binding.reviewPacketId)}`,
          `- Base / head: ${markdownBullet(report.binding.baseSha)} / ${markdownBullet(report.binding.headSha)}`,
          `- Diff digest: ${markdownBullet(report.binding.diffDigest)}`,
        ];
  const visualRows = report.visual.results.map(
    (result) =>
      `| ${markdownTableCell(result.name)} | ${result.baselineKind} | ${markdownTableCell(result.route)} / ${markdownTableCell(result.state)} | ${result.viewport.width}×${result.viewport.height} @${result.deviceScaleFactor}x | ${(result.metrics.exactMatchRatio * 100).toFixed(2)}% | ${(result.metrics.reviewMatchRatio * 100).toFixed(2)}% | ${(result.metrics.threshold * 100).toFixed(2)}% | ${result.baselineArtifactId} / ${result.actualArtifactId} / ${result.diffArtifactId} / ${result.overlayArtifactId} |`,
  );
  const apiRows = report.api.operations.map(
    (operation) =>
      `| ${markdownTableCell(operation.operationKey)} | ${operation.status} | ${markdownTableCell(operation.productionCallSites.join(", ") || "—")} | ${markdownTableCell(operation.mockHandlers.join(", ") || "—")} | ${markdownTableCell(operation.executableEvidencePaths.join(", ") || "—")} |`,
  );
  const legacyRows = report.legacy.coverage.map(
    (coverage) =>
      `| ${coverage.featureKey} | ${coverage.status} | ${markdownTableCell(coverage.requirementIds.join(", "))} | ${markdownTableCell(coverage.targetFiles.join(", ") || "—")} | ${markdownTableCell(coverage.executableEvidencePaths.join(", ") || "—")} |`,
  );
  const feature = report.featureEvidence;
  const lab = report.performance.evidence?.["lab"];
  const field = report.performance.evidence?.["field"];

  const rendered = [
    `# ${markdownInline(report.summary.title)}`,
    "",
    "## 1. Decision and review packet",
    "",
    `- Decision: ${report.decision}`,
    `- Mode: ${markdownBullet(report.mode)}`,
    `- Run: ${markdownBullet(report.runId)}`,
    ...bindingLines,
    "",
    "## 2. Change summary and exclusions",
    "",
    ...listOrNone(report.summary.bullets),
    "",
    "### Explicit exclusions",
    "",
    ...listOrNone(report.summary.exclusions),
    "",
    "## 3. Input sources and pinned provenance",
    "",
    "| Kind | Locator | Resolved | Digest | Captured |",
    "| --- | --- | --- | --- | --- |",
    ...report.sources.map(
      (source) =>
        `| ${source.kind} | ${markdownTableCell(source.locator)} | ${markdownTableCell(source.resolvedLocator ?? "—")} | ${markdownTableCell(source.digest ?? "—")} | ${markdownTableCell(source.capturedAt ?? "—")} |`,
    ),
    "",
    "### Applied skills",
    "",
    ...listOrNone(report.skills.applied),
    "",
    "## 4. Requirement traceability",
    "",
    "| Requirement | Acceptance criteria | Implementation | Review |",
    "| --- | --- | --- | --- |",
    ...report.requirements.map(
      (requirement) =>
        `| ${markdownTableCell(`${requirement.id}: ${requirement.title}`)} | ${markdownTableCell(requirement.acceptanceCriteria.join("\n"))} | ${markdownTableCell(requirement.implementationFiles.join(", ") || "—")} | ${markdownTableCell(requirement.reviewVerdicts.join(", ") || "—")} |`,
    ),
    "",
    "## 5. Changed files and implementation notes",
    "",
    ...listOrNone(report.changedFiles),
    "",
    ...listOrNone(report.implementationNotes),
    "",
    "## 6. API contract, usage, mocks, tests, and gaps",
    "",
    `- Section status: ${reportSectionStatus(report, "api", report.api.applicable)}`,
    ...(report.api.inventoryDigest === undefined
      ? []
      : [`- Inventory digest: ${report.api.inventoryDigest}`]),
    ...(report.api.discoveryAdapters === undefined
      ? []
      : [`- Discovery adapters: ${report.api.discoveryAdapters.join(", ")}`]),
    report.api.applicable
      ? "| Operation | Status | Production calls | Mocks | Executable evidence |"
      : "Not applicable.",
    ...(report.api.applicable ? ["| --- | --- | --- | --- | --- |", ...apiRows] : []),
    ...(report.api.applicable && report.api.operations.length === 0
      ? ["- No API operations detected by the bounded declared adapters."]
      : []),
    ...listOrNone(report.api.gaps),
    "",
    "## 7. Legacy migration coverage",
    "",
    `- Section status: ${reportSectionStatus(report, "legacy", report.legacy.applicable)}`,
    report.legacy.applicable
      ? "| Feature key | Status | Requirements | Target files | Executable evidence |"
      : "Not applicable.",
    ...(report.legacy.applicable ? ["| --- | --- | --- | --- | --- |", ...legacyRows] : []),
    "",
    "## 8. Visual fidelity",
    "",
    `- Section status: ${reportSectionStatus(report, "visual", report.visual.applicable)}`,
    `- Status: ${report.visual.status}`,
    `- Repair attempt: ${report.visual.attempt}`,
    ...(report.visual.applicable
      ? [
          "",
          "| Target | Baseline | Route / state | Viewport | Exact | Review | Threshold | Baseline / target / diff / overlay |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          ...visualRows,
        ]
      : ["- Not applicable."]),
    "",
    "## 9. Functional checks and independent review",
    "",
    `- Section status: ${reportSectionStatus(report, "functional-review", true)}`,
    ...reviewLines(report, "functional-review"),
    "",
    "## 10. Design and accessibility review",
    "",
    `- Section status: ${reportSectionStatus(report, "design-review", report.visual.applicable)}`,
    ...reviewLines(report, "design-review"),
    "",
    "## 11. Performance and Web Vitals",
    "",
    `- Section status: ${reportSectionStatus(report, "performance", report.performance.applicable)}`,
    report.performance.applicable
      ? `- Lab: ${markdownBullet(JSON.stringify(lab ?? {}))}`
      : "- Not applicable.",
    report.performance.applicable
      ? `- Field: ${markdownBullet(JSON.stringify(field ?? { status: "unavailable" }))}`
      : "",
    "",
    "## 12. Feature-targeted E2E and video",
    "",
    `- Section status: ${reportSectionStatus(report, "feature-evidence", feature !== undefined)}`,
    ...(feature === undefined
      ? ["Not applicable."]
      : [
          `- Selector: ${markdownBullet(String(feature["testSelector"] ?? "unavailable"))}`,
          `- Command: ${markdownBullet(String(feature["testCommand"] ?? "unavailable"))}`,
          `- Result: ${markdownBullet(String(feature["resultPath"] ?? "unavailable"))}`,
          `- Video: ${markdownBullet(String(feature["videoPath"] ?? "unavailable"))}`,
        ]),
    "",
    "## 13. Gaps, blockers, and unrun validations",
    "",
    ...listOrNone([
      ...report.gaps.map((gap) => `Gap: ${gap}`),
      ...report.blockers.map((blocker) => `Blocker: ${blocker}`),
      ...report.unrunValidations.map((validation) => `Not run: ${validation}`),
    ]),
    "",
    "## 14. Risks and mitigations",
    "",
    ...listOrNone(
      report.risks.map(
        (risk) =>
          `${risk.likelihood}/${risk.impact}: ${risk.mitigation} (${risk.evidence.join(", ") || "no evidence"})`,
      ),
    ),
    "",
    report.decision === "ready" ? "## 15. Rollback" : "## 15. Rollback and exact unblock action",
    "",
    `- Trigger: ${markdownBullet(report.rollback.trigger)}`,
    `- Strategy: ${markdownBullet(report.rollback.strategy)}`,
    `- Data impact: ${markdownBullet(report.rollback.dataImpact)}`,
    ...report.rollback.steps.map((step) => `- Step: ${markdownBullet(step)}`),
    ...report.rollback.postChecks.map((check) => `- Post-check: ${markdownBullet(check)}`),
    "",
    "## Evidence index",
    "",
    ...listOrNone(report.evidencePaths),
    "",
  ].join("\n");
  return redactSecretShapes(rendered);
}

const MARKDOWN_LIST_CONTROL_CHARACTERS = new Set([
  "\\",
  "`",
  "*",
  "_",
  "{",
  "}",
  "[",
  "]",
  "(",
  ")",
  "#",
  "+",
  "-",
  "!",
  "|",
  ">",
  "<",
  "&",
  "~",
  '"',
  "'",
  "=",
]);

function markdownListValue(value: string): string {
  return markdownBullet(value);
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function listOrNone(values: readonly string[]): string[] {
  return values.length === 0 ? ["- None."] : values.map((value) => `- ${markdownBullet(value)}`);
}

function reviewLines(report: PrReportV2, kind: "functional-review" | "design-review"): string[] {
  const review = report.reviews.find((candidate) => candidate.kind === kind);
  if (review === undefined) return ["- Not applicable."];
  return [
    `- Verdict: ${markdownBullet(review.verdict)}`,
    `- Summary: ${markdownBullet(review.summary)}`,
    `- Gates: ${markdownBullet(JSON.stringify(review.gates))}`,
    `- Findings: ${markdownBullet(JSON.stringify(review.findings))}`,
  ];
}

function reportSectionStatus(
  report: PrReportV2,
  section: keyof NonNullable<PrReportV2["sectionStatuses"]>,
  applicable: boolean,
): string {
  return report.sectionStatuses?.[section] ?? (applicable ? "complete" : "not-applicable");
}
