import type { RunManifest } from "../run/index.js";
import type { ArtifactRef } from "../runtime/artifact.js";
import type { CheckResult } from "../runtime/check.js";
import type { Gap } from "../runtime/gap.js";
import { decideReportStatus } from "./pr-report-decision-policy.js";
import {
  PrReportViewModelSchema,
  type ReportArtifactSummaryRow,
  type ReportCheckSummary,
  type ReportGateRow,
} from "./pr-report-model.js";
import type { PrReportViewModel, ReportSectionStatus } from "./pr-report-model.js";

export function collectPrReportViewModel(input: {
  run: RunManifest;
  generatedAt: string;
}): PrReportViewModel {
  const allChecks = input.run.agentResults.flatMap((result) => result.checks);
  const openGaps = input.run.gaps.filter(
    (gap) => gap.status === "open" || gap.status === "assumed",
  );
  const decision = decideReportStatus({
    checks: allChecks,
    gaps: input.run.gaps,
    artifacts: input.run.artifacts,
  });

  return PrReportViewModelSchema.parse({
    schemaVersion: "pr-report-v1",
    runId: input.run.id,
    generatedAt: input.generatedAt,
    decision,
    title: titleForRun(input.run),
    summaryBullets: summaryBulletsForRun(input.run),
    runMetadata: runMetadata(input.run),
    reviewGuide: reviewGuide(),
    gateRows: gateRows(input.run.artifacts, allChecks),
    specificationLinks: specificationLinks(input.run.artifacts),
    traceabilityRows: [],
    changeScopeRows: changeScopeRows(input.run.artifacts),
    apiRows: apiRows(input.run.artifacts),
    functionalChecks: checksByKinds(allChecks, [
      "unit",
      "component",
      "contract",
      "acceptance",
      "e2e",
    ]),
    designChecks: checksByKinds(allChecks, ["architecture"]),
    figmaProviderRows: figmaProviderRows(input.run.artifacts),
    figmaInventoryRows: figmaInventoryRows(input.run.artifacts),
    visualRows: visualRows(input.run.artifacts, allChecks),
    accessibilityChecks: checksByKinds(allChecks, ["accessibility"]),
    performanceRows: performanceRows(input.run.artifacts, allChecks),
    observabilityChecks: observabilityChecks(input.run.artifacts),
    runtimeChecks: checksByKinds(allChecks, ["lint", "typecheck", "build", "openspec"]),
    gapSummaries: openGaps.map(gapSummary),
    archivePlan: [
      "Do not archive the OpenSpec change before review and merge.",
      "After merge, run the OpenSpec archive workflow in Task 32.",
      "Archive should preserve proposal, design, tasks, specs, and artifacts under the archive folder.",
    ],
    reportArtifactIds: [],
  });
}

function titleForRun(run: RunManifest): string {
  const openspec = run.artifacts.find((artifact) => artifact.kind === "openspec");
  const changeName =
    typeof openspec?.metadata["changeName"] === "string"
      ? openspec.metadata["changeName"]
      : "spec-to-pr-change";

  return `Spec to PR Report - ${changeName}`;
}

function summaryBulletsForRun(run: RunManifest): string[] {
  return [
    `Run ${run.id} generated an evidence-backed implementation report.`,
    `${run.artifacts.length} artifact(s), ${run.evidence.length} evidence item(s), and ${run.gaps.length} gap(s) are recorded.`,
    "This report is generated from Run artifacts; natural-language completion claims are not treated as evidence.",
  ];
}

function runMetadata(run: RunManifest): Record<string, string> {
  return {
    "Run ID": run.id,
    "Plugin Version": run.pluginVersion,
    "Schema Version": run.schemaVersion,
    "Project Root": run.projectRoot,
    Status: run.status,
    Revision: String(run.revision),
    "Created At": run.createdAt,
    "Updated At": run.updatedAt,
  };
}

function reviewGuide(): string[] {
  return [
    "Start with Gate Summary and Decision; blocked reports are not publishable.",
    "Review Specification to confirm which OpenSpec change is implemented.",
    "Review API Generator / API Contract for generated client and wrapper boundary.",
    "Review Functional Verification for requirement coverage and test status.",
    "Review Design Contract and Visual Regression for Figma parity.",
    "Review Gaps And Review Notes for intentionally unimplemented or unsupported items.",
    "Do not treat this report as publish evidence until Task 31 publisher records a PR/MR URL.",
  ];
}

function gateRows(artifacts: ArtifactRef[], checks: CheckResult[]): ReportGateRow[] {
  const hasFigma = hasFigmaEvidence(artifacts);

  return [
    {
      gate: "Runtime verification",
      required: true,
      ...statusForCheckKinds(checks, ["lint", "typecheck", "build"], "lint/typecheck/build"),
    },
    {
      gate: "Functional verification",
      required: true,
      ...statusForCheckKinds(
        checks,
        ["unit", "component", "contract", "acceptance", "e2e"],
        "unit/component/contract/acceptance/e2e",
      ),
    },
    {
      gate: "OpenSpec / specification",
      required: true,
      ...statusForCheckKinds(checks, ["openspec"], "openspec"),
    },
    {
      gate: "Figma provider capability",
      required: hasFigma,
      ...artifactGateStatus({
        artifacts,
        kinds: ["figma-mcp-capability-report", "figma-provider-policy"],
        notApplicableWhen: !hasFigma,
        notRunNote: "Figma evidence exists, but provider capability was not recorded.",
        passNote: "Figma provider capability artifact is recorded.",
      }),
    },
    {
      gate: "Figma design inventory",
      required: hasFigma,
      ...artifactGateStatus({
        artifacts,
        kinds: ["figma-design-inventory", "figma-provider-comparison"],
        notApplicableWhen: !hasFigma,
        notRunNote: "Figma evidence exists, but design-system inventory was not recorded.",
        passNote: "Figma design-system inventory artifact is recorded.",
      }),
    },
    {
      gate: "Visual regression",
      required: hasFigma,
      ...visualGateStatus({ artifacts, checks, hasFigma }),
    },
    {
      gate: "Accessibility",
      required: true,
      ...statusForCheckKinds(checks, ["accessibility"], "accessibility"),
    },
    {
      gate: "Performance / Web Vitals",
      required: true,
      ...combinedGateStatus({
        checkStatus: statusForCheckKinds(checks, ["performance"], "performance"),
        artifactStatus: artifactGateStatus({
          artifacts,
          kinds: ["performance-report"],
          notApplicableWhen: false,
          notRunNote: "No performance report artifact was recorded.",
          passNote: "Performance report artifact is recorded.",
        }),
      }),
    },
    {
      gate: "Security hardening",
      required: true,
      ...statusForCheckKinds(checks, ["security"], "security"),
    },
    {
      gate: "Observability",
      required: true,
      ...artifactGateStatus({
        artifacts,
        kinds: ["telemetry-config"],
        notApplicableWhen: false,
        notRunNote: "No observability report artifact was recorded.",
        passNote: "Observability report artifact is recorded.",
      }),
    },
  ];
}

function figmaProviderRows(artifacts: ArtifactRef[]): ReportArtifactSummaryRow[] {
  return summarizeArtifactKinds({
    artifacts,
    rows: [
      {
        item: "Provider capability",
        kinds: ["figma-mcp-capability-report"],
        missing: "No Figma provider capability report was recorded.",
      },
      {
        item: "Provider policy",
        kinds: ["figma-provider-policy"],
        missing: "No provider selection policy artifact was recorded.",
      },
    ],
  });
}

function figmaInventoryRows(artifacts: ArtifactRef[]): ReportArtifactSummaryRow[] {
  return summarizeArtifactKinds({
    artifacts,
    rows: [
      {
        item: "Raw metadata",
        kinds: ["figma-metadata", "figma-design-context"],
        missing: "No raw Figma metadata or design context artifact was recorded.",
      },
      {
        item: "Screenshot baseline",
        kinds: ["figma-screenshot"],
        missing: "No Figma screenshot baseline artifact was recorded.",
      },
      {
        item: "Variables / styles",
        kinds: ["figma-variable-defs"],
        missing: "No Figma variable/style artifact was recorded.",
      },
      {
        item: "Code Connect map",
        kinds: ["figma-code-connect-map"],
        missing: "No Figma Code Connect map artifact was recorded.",
      },
      {
        item: "Design-system inventory",
        kinds: ["figma-design-inventory", "figma-provider-comparison"],
        missing: "No Figma design-system inventory artifact was recorded.",
      },
      {
        item: "Design contract",
        kinds: ["figma-design-contract", "design-system-map", "ui-implementation-rules"],
        missing: "No Figma design contract artifact was recorded.",
      },
    ],
  });
}

function statusForCheckKinds(
  checks: CheckResult[],
  kinds: string[],
  label: string,
): Pick<ReportGateRow, "status" | "evidence" | "notes"> {
  const matchingChecks = checks.filter((check) => kinds.includes(check.kind));

  if (matchingChecks.length === 0) {
    return {
      status: "not-run",
      evidence: [],
      notes: `No ${label} CheckResult was recorded.`,
    };
  }

  if (matchingChecks.some((check) => check.status === "failed")) {
    return {
      status: "fail",
      evidence: matchingChecks.map((check) => check.name),
      notes: "At least one required check failed.",
    };
  }

  if (matchingChecks.some((check) => check.status === "skipped")) {
    return {
      status: "skipped",
      evidence: matchingChecks.map((check) => check.name),
      notes: "At least one required check was skipped.",
    };
  }

  return {
    status: "pass",
    evidence: matchingChecks.map((check) => check.name),
    notes: "Recorded checks passed.",
  };
}

function artifactGateStatus(input: {
  artifacts: ArtifactRef[];
  kinds: string[];
  notApplicableWhen: boolean;
  notRunNote: string;
  passNote: string;
}): Pick<ReportGateRow, "status" | "evidence" | "notes"> {
  if (input.notApplicableWhen) {
    return {
      status: "not-applicable",
      evidence: [],
      notes: "No matching source evidence was recorded for this gate.",
    };
  }

  const matchingArtifacts = input.artifacts.filter((artifact) =>
    input.kinds.includes(artifact.kind),
  );

  if (matchingArtifacts.length === 0) {
    return {
      status: "not-run",
      evidence: [],
      notes: input.notRunNote,
    };
  }

  return {
    status: "pass",
    evidence: matchingArtifacts.map((artifact) => artifact.id),
    notes: input.passNote,
  };
}

function visualGateStatus(input: {
  artifacts: ArtifactRef[];
  checks: CheckResult[];
  hasFigma: boolean;
}): Pick<ReportGateRow, "status" | "evidence" | "notes"> {
  if (!input.hasFigma) {
    return {
      status: "not-applicable",
      evidence: [],
      notes: "No Figma-backed visual source was recorded.",
    };
  }

  const visualReports = input.artifacts.filter(
    (artifact) =>
      artifact.kind === "visual-report" && artifact.metadata["reportKind"] === "visual-report-json",
  );
  const visualCheckStatus = statusForCheckKinds(input.checks, ["visual"], "visual");

  if (visualReports.length > 0) {
    return {
      status: visualCheckStatus.status === "fail" ? "fail" : "pass",
      evidence: [...visualReports.map((artifact) => artifact.id), ...visualCheckStatus.evidence],
      notes: "Figma/browser visual comparison artifact is recorded.",
    };
  }

  return {
    status: "not-run",
    evidence: visualCheckStatus.evidence,
    notes: "Figma evidence exists, but no Figma/browser visual comparison artifact was recorded.",
  };
}

function combinedGateStatus(input: {
  checkStatus: Pick<ReportGateRow, "status" | "evidence" | "notes">;
  artifactStatus: Pick<ReportGateRow, "status" | "evidence" | "notes">;
}): Pick<ReportGateRow, "status" | "evidence" | "notes"> {
  if (input.checkStatus.status === "fail" || input.artifactStatus.status === "fail") {
    return {
      status: "fail",
      evidence: [...input.checkStatus.evidence, ...input.artifactStatus.evidence],
      notes: "At least one check or artifact gate failed.",
    };
  }

  if (input.checkStatus.status === "pass" || input.artifactStatus.status === "pass") {
    return {
      status: "pass",
      evidence: [...input.checkStatus.evidence, ...input.artifactStatus.evidence],
      notes: "Performance evidence was recorded.",
    };
  }

  return input.checkStatus.status === "skipped" ? input.checkStatus : input.artifactStatus;
}

function summarizeArtifactKinds(input: {
  artifacts: ArtifactRef[];
  rows: Array<{
    item: string;
    kinds: string[];
    missing: string;
  }>;
}): ReportArtifactSummaryRow[] {
  return input.rows.map((row) => {
    const matchingArtifacts = input.artifacts.filter((artifact) =>
      row.kinds.includes(artifact.kind),
    );

    if (matchingArtifacts.length === 0) {
      return {
        item: row.item,
        status: "not-run",
        artifacts: [],
        notes: row.missing,
      };
    }

    return {
      item: row.item,
      status: "pass",
      artifacts: matchingArtifacts.map((artifact) => artifact.id),
      notes: "Recorded.",
    };
  });
}

function hasFigmaEvidence(artifacts: ArtifactRef[]): boolean {
  return artifacts.some((artifact) => artifact.kind.startsWith("figma-"));
}

function specificationLinks(artifacts: ArtifactRef[]) {
  return artifacts
    .filter((artifact) => artifact.kind === "openspec")
    .map((artifact) => ({
      label: String(artifact.metadata["relativePath"] ?? artifact.id),
      uri: artifact.uri,
    }));
}

function changeScopeRows(artifacts: ArtifactRef[]) {
  const byKind = new Map<string, number>();

  for (const artifact of artifacts) {
    byKind.set(artifact.kind, (byKind.get(artifact.kind) ?? 0) + 1);
  }

  return [...byKind.entries()].map(([kind, count]) => ({
    Area: kind,
    "Artifact Count": String(count),
    "Review Focus": reviewFocusForArtifactKind(kind),
  }));
}

function apiRows(artifacts: ArtifactRef[]) {
  return artifacts
    .filter((artifact) =>
      ["openapi-intake-report", "api-contract-report", "generated-code"].includes(artifact.kind),
    )
    .map((artifact) => ({
      Artifact: artifact.id,
      Kind: artifact.kind,
      URI: artifact.uri,
      Digest: artifact.digest,
    }));
}

function checksByKinds(checks: CheckResult[], kinds: string[]): ReportCheckSummary[] {
  const kindSet = new Set(kinds);

  return checks
    .filter((check) => kindSet.has(check.kind))
    .map((check) => ({
      name: check.name,
      kind: check.kind,
      status: statusForCheck(check),
      command: check.command,
      exitCode: check.exitCode,
      reportArtifactId: check.reportArtifactId,
      summary: check.summary,
    }));
}

function visualRows(artifacts: ArtifactRef[], checks: CheckResult[]) {
  const visualReports = artifacts.filter(
    (artifact) =>
      artifact.kind === "visual-report" && artifact.metadata["reportKind"] === "visual-report-json",
  );
  const visualChecks = checksByKinds(checks, ["visual"]);

  if (visualReports.length === 0 && visualChecks.length === 0) {
    return [];
  }

  if (visualReports.length === 0) {
    return visualChecks.map((check) => ({
      state: check.name,
      result: check.status,
      notes: check.summary,
    }));
  }

  return visualReports.map((artifact) => ({
    state: String(artifact.metadata["changeName"] ?? artifact.id),
    result: statusFromMetadataDecision(artifact.metadata["decision"], "warning"),
    notes:
      "Visual report artifact is available. Review algorithm, thresholds, masks, viewport, browser, and font environment in the artifact.",
  }));
}

function performanceRows(artifacts: ArtifactRef[], checks: CheckResult[]) {
  const performanceReports = artifacts.filter(
    (artifact) =>
      artifact.kind === "performance-report" &&
      artifact.metadata["reportKind"] === "performance-report-json",
  );
  const performanceChecks = checksByKinds(checks, ["performance"]);

  if (performanceReports.length === 0 && performanceChecks.length === 0) {
    return [];
  }

  const rows = performanceChecks.map((check) => ({
    metric: check.name,
    value: check.summary,
    budget: check.exitCode === undefined ? undefined : `exitCode ${check.exitCode}`,
    result: check.status,
    source: "CheckResult",
  }));

  rows.push(
    ...performanceReports.map((artifact) => ({
      metric: "Performance report",
      value: String(artifact.metadata["webVitalsReadiness"] ?? artifact.id),
      budget: undefined,
      result: statusFromMetadataDecision(artifact.metadata["decision"], "warning"),
      source:
        "Lighthouse lab and Web Vitals readiness artifact; field data requires RUM or CrUX evidence.",
    })),
  );

  return rows;
}

function observabilityChecks(artifacts: ArtifactRef[]): ReportCheckSummary[] {
  return artifacts
    .filter(
      (artifact) =>
        artifact.kind === "telemetry-config" &&
        artifact.metadata["reportKind"] === "observability-report-json",
    )
    .map((artifact) => ({
      name: "OpenTelemetry / Observability report",
      kind: "other",
      status: Number(artifact.metadata["gapCount"] ?? 0) > 0 ? "warning" : "pass",
      reportArtifactId: artifact.id,
      summary:
        "Observability report artifact generated. It does not prove collector deployment or production telemetry collection.",
    }));
}

function statusForCheck(check: CheckResult): ReportSectionStatus {
  if (check.status === "passed") {
    return "pass";
  }

  if (check.status === "failed") {
    return "fail";
  }

  return "skipped";
}

function statusFromMetadataDecision(
  value: unknown,
  fallback: ReportSectionStatus,
): ReportSectionStatus {
  if (value === "passed" || value === "pass") {
    return "pass";
  }

  if (value === "failed" || value === "blocked" || value === "fail") {
    return "fail";
  }

  if (value === "review-needed" || value === "warning") {
    return "warning";
  }

  return fallback;
}

function gapSummary(gap: Gap) {
  return {
    id: gap.id,
    category: gap.category,
    severity: gap.severity,
    status: gap.status,
    title: gap.title,
    impact: gap.impact,
  };
}

function reviewFocusForArtifactKind(kind: string): string {
  switch (kind) {
    case "openspec":
      return "Requirement and scope correctness";
    case "openapi-intake-report":
    case "api-contract-report":
      return "API operation coverage and gaps";
    case "figma-design-context":
    case "figma-screenshot":
    case "figma-variable-defs":
      return "Design evidence and parity";
    case "test-report":
      return "Functional verification";
    case "visual-report":
      return "Figma/browser comparison";
    case "accessibility-report":
      return "Automated and manual accessibility evidence";
    case "performance-report":
      return "Lab performance and Web Vitals readiness";
    case "telemetry-config":
      return "Trace/log correlation and telemetry readiness";
    default:
      return "Evidence review";
  }
}
