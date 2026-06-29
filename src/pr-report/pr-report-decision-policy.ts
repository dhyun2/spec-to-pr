import type { CheckResult } from "../runtime/check.js";
import type { Gap } from "../runtime/gap.js";
import type { ArtifactRef } from "../runtime/artifact.js";
import type { SourceRef } from "../runtime/source.js";
import type { ReportDecision } from "./pr-report-model.js";

const MANDATORY_CHECK_KINDS = ["lint", "typecheck", "build", "openspec", "security"] as const;

const FUNCTIONAL_CHECK_KINDS = ["unit", "component", "contract", "acceptance", "e2e"] as const;

export function decideReportStatus(input: {
  checks: CheckResult[];
  gaps: Gap[];
  artifacts?: ArtifactRef[];
  sources?: SourceRef[];
}): ReportDecision {
  const requirements = buildReportGateRequirements(input);
  const mandatoryFailures = input.checks.some(
    (check) =>
      requiredCheckKinds(requirements).some((kind) => kind === check.kind) &&
      check.status === "failed",
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

  if (requirements.figma && !hasVisualComparisonEvidence(input)) {
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
  sources?: SourceRef[];
}): boolean {
  const artifacts = input.artifacts ?? [];
  const requirements = buildReportGateRequirements(input);

  if (!requiredCheckKinds(requirements).every((kind) => hasPassedCheck(input.checks, kind))) {
    return true;
  }

  if (!FUNCTIONAL_CHECK_KINDS.some((kind) => hasPassedCheck(input.checks, kind))) {
    return true;
  }

  if (requirements.accessibility && !hasAccessibilityEvidence(input)) {
    return true;
  }

  if (requirements.performance && !hasPerformanceEvidence(input)) {
    return true;
  }

  if (requirements.observability && !hasObservabilityEvidence(artifacts)) {
    return true;
  }

  if (requirements.figma) {
    return !hasRequiredFigmaEvidence(artifacts) || !hasVisualComparisonEvidence(input);
  }

  return false;
}

export type ReportGateRequirements = {
  runtime: true;
  functional: true;
  openspec: boolean;
  security: boolean;
  accessibility: boolean;
  performance: boolean;
  observability: boolean;
  figma: boolean;
};

export function buildReportGateRequirements(input: {
  artifacts?: ArtifactRef[];
  sources?: SourceRef[];
}): ReportGateRequirements {
  const artifacts = input.artifacts ?? [];
  const sources = input.sources ?? [];
  const hasSourceProfile = input.sources !== undefined;
  const hasFigma =
    hasFigmaVisualEvidence(artifacts) || sources.some((source) => source.kind === "figma");
  const hasOpenSpecScope =
    !hasSourceProfile ||
    sources.some((source) => ["brief", "figma", "openapi"].includes(source.kind)) ||
    artifacts.some((artifact) =>
      ["openspec", "traceability-graph", "traceability-matrix", "gherkin-feature"].includes(
        artifact.kind,
      ),
    );
  const strictWhenUnprofiled = !hasSourceProfile;

  return {
    runtime: true,
    functional: true,
    openspec: hasOpenSpecScope,
    security: strictWhenUnprofiled || hasSecurityEvidence(artifacts),
    accessibility: strictWhenUnprofiled || hasFigma,
    performance: strictWhenUnprofiled || hasFigma,
    observability: strictWhenUnprofiled || hasObservabilityEvidence(artifacts),
    figma: hasFigma,
  };
}

function requiredCheckKinds(requirements: ReportGateRequirements): Array<CheckResult["kind"]> {
  return MANDATORY_CHECK_KINDS.filter((kind) => {
    if (kind === "openspec") return requirements.openspec;
    if (kind === "security") return requirements.security;
    return true;
  });
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

function hasSecurityEvidence(artifacts: ArtifactRef[]): boolean {
  return artifacts.some(
    (artifact) =>
      artifact.kind === "agent-result-report" &&
      ["security-hardening", "security-report"].includes(String(artifact.metadata["reportKind"])),
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
