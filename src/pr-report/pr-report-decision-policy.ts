import type { CheckResult } from "../runtime/check.js";
import type { Gap } from "../runtime/gap.js";
import type { ArtifactRef } from "../runtime/artifact.js";
import type { SourceRef } from "../runtime/source.js";
import { isReviewScorecardBlocking, latestReviewScorecard } from "../review-scorecard/index.js";
import type { ReportDecision } from "./pr-report-model.js";
import {
  isComponentVisualComparisonArtifact,
  isVisualComparisonArtifact,
  visualComparisonStatusFromMetadata,
} from "./visual-evidence.js";

const MANDATORY_CHECK_KINDS = ["lint", "typecheck", "build", "openspec", "security"] as const;

const FUNCTIONAL_CHECK_KINDS = ["unit", "component", "contract", "acceptance", "e2e"] as const;

export function decideReportStatus(input: {
  checks: CheckResult[];
  gaps: Gap[];
  artifacts?: ArtifactRef[];
  sources?: SourceRef[];
}): ReportDecision {
  const checks = selectLatestChecksByKind(input.checks);
  const gaps = activeGapsForLatestChecks(input.gaps, checks);
  const normalizedInput = {
    ...input,
    checks,
    gaps,
  };
  const requirements = buildReportGateRequirements(input);
  const mandatoryFailures = checks.some(
    (check) =>
      requiredCheckKinds(requirements).some((kind) => kind === check.kind) &&
      check.status === "failed",
  );

  if (mandatoryFailures) {
    return "blocked";
  }

  const openBlockerGap = gaps.some(
    (gap) => gap.severity === "blocker" && ["open", "assumed"].includes(gap.status),
  );

  if (openBlockerGap) {
    return "blocked";
  }

  if (hasMissingRequiredGate(normalizedInput)) {
    return "blocked";
  }

  if (hasIncompleteLegacyCoverage(input.artifacts ?? [])) {
    return "blocked";
  }

  if (hasFailedPublishSynchronization(input.artifacts ?? [])) {
    return "blocked";
  }

  if (
    latestReviewScorecard(input.artifacts ?? []) === undefined ||
    isReviewScorecardBlocking(input.artifacts ?? [])
  ) {
    return "blocked";
  }

  if (requirements.figma && !hasVisualComparisonEvidence(normalizedInput)) {
    return "blocked";
  }

  if (
    hasComponentContracts(input.artifacts ?? []) &&
    !hasComponentVisualComparisonEvidence(normalizedInput)
  ) {
    return "blocked";
  }

  const openMajorGap = gaps.some(
    (gap) => gap.severity === "major" && ["open", "assumed"].includes(gap.status),
  );

  if (openMajorGap) {
    return "draft";
  }

  if (hasVisualComparisonNeedingReview(input.artifacts ?? [])) {
    return "ready-after-review";
  }

  const visualOrA11yNeedsReview = checks.some(
    (check) =>
      ["visual", "accessibility"].includes(check.kind) &&
      (check.status === "skipped" || check.status === "failed"),
  );

  if (visualOrA11yNeedsReview) {
    return "ready-after-review";
  }

  return "ready";
}

export function selectLatestChecksByKind(checks: CheckResult[]): CheckResult[] {
  const latest = new Map<CheckResult["kind"], { check: CheckResult; sequence: number }>();

  checks.forEach((check, sequence) => {
    const current = latest.get(check.kind);

    if (current === undefined || isNewerCheck({ check, sequence }, current)) {
      latest.set(check.kind, { check, sequence });
    }
  });

  return [...latest.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .map((item) => item.check);
}

export function activeGapsForLatestChecks(gaps: Gap[], checks: CheckResult[]): Gap[] {
  const latestByKind = new Map(checks.map((check) => [check.kind, check]));

  return gaps.filter((gap) => {
    if (!["open", "assumed"].includes(gap.status) || !isQualityGateGap(gap)) {
      return true;
    }

    const checkKind = gap.metadata["checkKind"];

    if (typeof checkKind !== "string") {
      return true;
    }

    const latestCheck = latestByKind.get(checkKind as CheckResult["kind"]);

    if (latestCheck === undefined || latestCheck.status !== "passed") {
      return true;
    }

    const checkName = gap.metadata["checkName"];

    return typeof checkName === "string" && checkName !== latestCheck.name;
  });
}

function isNewerCheck(
  candidate: { check: CheckResult; sequence: number },
  current: { check: CheckResult; sequence: number },
): boolean {
  const candidateTimestamp = checkTimestamp(candidate.check);
  const currentTimestamp = checkTimestamp(current.check);

  if (candidateTimestamp !== undefined && currentTimestamp !== undefined) {
    return candidateTimestamp === currentTimestamp
      ? candidate.sequence > current.sequence
      : candidateTimestamp > currentTimestamp;
  }

  return candidate.sequence > current.sequence;
}

function checkTimestamp(check: CheckResult): number | undefined {
  const timestamp = Date.parse(check.completedAt ?? check.startedAt ?? "");

  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isQualityGateGap(gap: Gap): boolean {
  return (
    typeof gap.metadata["checkKind"] === "string" &&
    typeof gap.metadata["checkId"] === "string" &&
    gap.title.startsWith("Quality gate ")
  );
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
    return (
      !hasRequiredFigmaEvidence(artifacts) ||
      !hasVisualComparisonEvidence(input) ||
      (hasComponentContracts(artifacts) && !hasComponentVisualComparisonEvidence(input))
    );
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
  const gateIntent = extractGateIntent(artifacts);
  const hasSourceProfile = input.sources !== undefined;
  const hasFigma =
    hasFigmaVisualEvidence(artifacts) || sources.some((source) => source.kind === "figma");
  const hasOpenSpecScope =
    !hasSourceProfile ||
    gateIntent.openspec === true ||
    sources.some((source) => ["instruction", "brief", "figma", "openapi"].includes(source.kind)) ||
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
    security: strictWhenUnprofiled || gateIntent.security === true,
    accessibility: strictWhenUnprofiled || hasFigma || gateIntent.accessibility === true,
    performance: strictWhenUnprofiled || hasFigma || gateIntent.performance === true,
    observability: strictWhenUnprofiled || gateIntent.observability === true,
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

type GateIntent = {
  openspec?: boolean;
  security?: boolean;
  accessibility?: boolean;
  performance?: boolean;
  observability?: boolean;
};

function extractGateIntent(artifacts: ArtifactRef[]): GateIntent {
  const parsedIntakeArtifact = [...artifacts]
    .reverse()
    .find((artifact) => artifact.kind === "parsed-intake-request");

  if (parsedIntakeArtifact === undefined) {
    return {};
  }

  const rawGatePolicy = parsedIntakeArtifact.metadata["gatePolicy"];

  if (!isRecord(rawGatePolicy)) {
    return {};
  }

  return {
    ...optionalBooleanFlag(rawGatePolicy, "openspec"),
    ...optionalBooleanFlag(rawGatePolicy, "security"),
    ...optionalBooleanFlag(rawGatePolicy, "accessibility"),
    ...optionalBooleanFlag(rawGatePolicy, "performance"),
    ...optionalBooleanFlag(rawGatePolicy, "observability"),
  };
}

function optionalBooleanFlag(record: Record<string, unknown>, key: keyof GateIntent): GateIntent {
  const value = record[key];

  return typeof value === "boolean" ? { [key]: value } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    (input.artifacts ?? []).some(isVisualComparisonArtifact)
  );
}

function hasComponentVisualComparisonEvidence(input: {
  checks: CheckResult[];
  artifacts?: ArtifactRef[];
}): boolean {
  return (input.artifacts ?? []).some(isComponentVisualComparisonArtifact);
}

function hasComponentContracts(artifacts: ArtifactRef[]): boolean {
  return artifacts.some(
    (artifact) =>
      ["figma-design-contract", "design-system-map"].includes(artifact.kind) &&
      Number(artifact.metadata["componentContractCount"] ?? 0) > 0,
  );
}

function hasVisualComparisonNeedingReview(artifacts: ArtifactRef[]): boolean {
  return artifacts
    .filter(isVisualComparisonArtifact)
    .some((artifact) =>
      ["fail", "warning"].includes(
        visualComparisonStatusFromMetadata(artifact.metadata["decision"], "pass"),
      ),
    );
}

function hasIncompleteLegacyCoverage(artifacts: ArtifactRef[]): boolean {
  const latestInventory = [...artifacts]
    .reverse()
    .find(
      (artifact) =>
        artifact.kind === "legacy-feature-inventory" &&
        artifact.metadata["reportKind"] === "legacy-feature-inventory-json",
    );

  if (latestInventory === undefined) {
    return false;
  }

  const matrix = [...artifacts]
    .reverse()
    .find(
      (artifact) =>
        artifact.kind === "feature-coverage-matrix" &&
        artifact.metadata["reportKind"] === "feature-coverage-matrix-json" &&
        artifact.metadata["inventoryArtifactId"] === latestInventory.id,
    );

  if (matrix === undefined) {
    return true;
  }

  return (
    metadataNumber(matrix.metadata["uncoveredCount"]) > 0 ||
    metadataNumber(matrix.metadata["documentedOnlyCount"]) > 0
  );
}

function hasFailedPublishSynchronization(artifacts: ArtifactRef[]): boolean {
  const latestPublishResult = [...artifacts]
    .reverse()
    .find(
      (artifact) =>
        artifact.kind === "agent-result-report" &&
        artifact.metadata["reportKind"] === "publish-result",
    );

  if (latestPublishResult === undefined) {
    return false;
  }

  if (["failed", "blocked"].includes(String(latestPublishResult.metadata["status"] ?? ""))) {
    return true;
  }

  if (latestPublishResult.metadata["requestSynced"] === false) {
    return true;
  }

  return (
    latestPublishResult.metadata["requestDraft"] === false ||
    (latestPublishResult.metadata["visualPreviewExpected"] === true &&
      latestPublishResult.metadata["visualPreviewSynced"] !== true) ||
    (latestPublishResult.metadata["featureVideoExpected"] === true &&
      latestPublishResult.metadata["featureVideoSynced"] !== true)
  );
}

function metadataNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
