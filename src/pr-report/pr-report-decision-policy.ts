import type { CheckResult } from "../runtime/check.js";
import type { Gap } from "../runtime/gap.js";
import type { ArtifactRef } from "../runtime/artifact.js";
import type { ReportDecision } from "./pr-report-model.js";

const MANDATORY_CHECK_KINDS = ["lint", "typecheck", "build", "openspec", "security"] as const;

const FUNCTIONAL_CHECK_KINDS = ["unit", "component", "contract", "acceptance", "e2e"] as const;

export function decideReportStatus(input: {
  checks: CheckResult[];
  gaps: Gap[];
  artifacts?: ArtifactRef[];
}): ReportDecision {
  const mandatoryFailures = input.checks.some(
    (check) =>
      MANDATORY_CHECK_KINDS.some((kind) => kind === check.kind) && check.status === "failed",
  );

  if (mandatoryFailures) {
    return "blocked";
  }

  const openBlockerGap = input.gaps.some(
    (gap) => gap.severity === "blocker" && ["open", "assumed"].includes(gap.status),
  );

  if (openBlockerGap) {
    return "blocked";
  }

  if (hasMissingRequiredGate(input)) {
    return "blocked";
  }

  if (hasFigmaVisualEvidence(input.artifacts ?? []) && !hasVisualComparisonEvidence(input)) {
    return "blocked";
  }

  const openMajorGap = input.gaps.some(
    (gap) => gap.severity === "major" && ["open", "assumed"].includes(gap.status),
  );

  if (openMajorGap) {
    return "draft";
  }

  const visualOrA11yNeedsReview = input.checks.some(
    (check) =>
      ["visual", "accessibility"].includes(check.kind) &&
      (check.status === "skipped" || check.status === "failed"),
  );

  if (visualOrA11yNeedsReview) {
    return "ready-after-review";
  }

  return "ready";
}

function hasMissingRequiredGate(input: {
  checks: CheckResult[];
  artifacts?: ArtifactRef[];
}): boolean {
  const artifacts = input.artifacts ?? [];

  if (!MANDATORY_CHECK_KINDS.every((kind) => hasPassedCheck(input.checks, kind))) {
    return true;
  }

  if (!FUNCTIONAL_CHECK_KINDS.some((kind) => hasPassedCheck(input.checks, kind))) {
    return true;
  }

  if (!hasAccessibilityEvidence(input)) {
    return true;
  }

  if (!hasPerformanceEvidence(input)) {
    return true;
  }

  if (!hasObservabilityEvidence(artifacts)) {
    return true;
  }

  if (hasFigmaVisualEvidence(artifacts)) {
    return !hasRequiredFigmaEvidence(artifacts) || !hasVisualComparisonEvidence(input);
  }

  return false;
}

function hasPassedCheck(checks: CheckResult[], kind: CheckResult["kind"]): boolean {
  return checks.some((check) => check.kind === kind && check.status === "passed");
}

function hasAccessibilityEvidence(input: {
  checks: CheckResult[];
  artifacts?: ArtifactRef[];
}): boolean {
  return (
    hasPassedCheck(input.checks, "accessibility") ||
    (input.artifacts ?? []).some((artifact) => artifact.kind === "accessibility-report")
  );
}

function hasPerformanceEvidence(input: {
  checks: CheckResult[];
  artifacts?: ArtifactRef[];
}): boolean {
  return (
    hasPassedCheck(input.checks, "performance") ||
    (input.artifacts ?? []).some(
      (artifact) =>
        artifact.kind === "performance-report" &&
        artifact.metadata["reportKind"] === "performance-report-json",
    )
  );
}

function hasObservabilityEvidence(artifacts: ArtifactRef[]): boolean {
  return artifacts.some(
    (artifact) =>
      artifact.kind === "telemetry-config" &&
      artifact.metadata["reportKind"] === "observability-report-json",
  );
}

function hasRequiredFigmaEvidence(artifacts: ArtifactRef[]): boolean {
  const hasProviderCapability = artifacts.some(
    (artifact) => artifact.kind === "figma-mcp-capability-report",
  );
  const hasInventory = artifacts.some((artifact) =>
    ["figma-design-inventory", "figma-provider-comparison"].includes(artifact.kind),
  );
  const hasDesignContract = artifacts.some((artifact) =>
    ["figma-design-contract", "design-system-map", "ui-implementation-rules"].includes(
      artifact.kind,
    ),
  );

  return hasProviderCapability && hasInventory && hasDesignContract;
}

function hasFigmaVisualEvidence(artifacts: ArtifactRef[]): boolean {
  return artifacts.some((artifact) =>
    [
      "figma-design-context",
      "figma-screenshot",
      "figma-design-inventory",
      "figma-design-contract",
    ].includes(artifact.kind),
  );
}

function hasVisualComparisonEvidence(input: {
  checks: CheckResult[];
  artifacts?: ArtifactRef[];
}): boolean {
  return (
    input.checks.some((check) => check.kind === "visual" && check.status === "passed") ||
    (input.artifacts ?? []).some(
      (artifact) =>
        artifact.kind === "visual-report" &&
        artifact.metadata["reportKind"] === "visual-report-json",
    )
  );
}
