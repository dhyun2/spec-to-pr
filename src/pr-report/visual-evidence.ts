import type { ArtifactRef } from "../runtime/artifact.js";
import type { ReportSectionStatus } from "./pr-report-model.js";

export function isVisualComparisonArtifact(artifact: ArtifactRef): boolean {
  if (artifact.kind !== "visual-report") {
    return false;
  }

  const reportKind = artifact.metadata["reportKind"];

  if (reportKind === "visual-report-json") {
    return true;
  }

  if (reportKind !== "visual-review-result") {
    return false;
  }

  return (
    artifact.metadata["visualEvidenceRole"] === "comparison-report" ||
    artifact.metadata["comparisonMode"] === "legacy-vs-target" ||
    artifact.metadata["visualBaseline"] === "legacy-screenshot" ||
    artifact.metadata["adapter"] === "legacy-vs-target-visual" ||
    (artifact.metadata["comparisonBaseline"] === "legacy" &&
      artifact.metadata["comparisonActual"] === "target")
  );
}

export function isLegacyVsTargetVisualComparisonArtifact(artifact: ArtifactRef): boolean {
  return (
    isVisualComparisonArtifact(artifact) &&
    (artifact.metadata["comparisonMode"] === "legacy-vs-target" ||
      artifact.metadata["visualBaseline"] === "legacy-screenshot" ||
      artifact.metadata["adapter"] === "legacy-vs-target-visual" ||
      (artifact.metadata["comparisonBaseline"] === "legacy" &&
        artifact.metadata["comparisonActual"] === "target"))
  );
}

export function isComponentVisualComparisonArtifact(artifact: ArtifactRef): boolean {
  return (
    isVisualComparisonArtifact(artifact) &&
    (artifact.metadata["comparisonScope"] === "component" ||
      artifact.metadata["visualScope"] === "component" ||
      artifact.metadata["reportKind"] === "component-visual-report-json" ||
      artifact.metadata["componentContractId"] !== undefined)
  );
}

export function visualComparisonStatusFromMetadata(
  value: unknown,
  fallback: ReportSectionStatus,
): ReportSectionStatus {
  if (value === "passed" || value === "pass" || value === "success") {
    return "pass";
  }

  if (value === "failed" || value === "blocked" || value === "fail" || value === "error") {
    return "fail";
  }

  if (value === "review-needed" || value === "needs-review" || value === "warning") {
    return "warning";
  }

  return fallback;
}

export function visualPercentFromMetadata(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  if (value >= 0 && value <= 1) {
    return value * 100;
  }

  if (value >= 0 && value <= 100) {
    return value;
  }

  return undefined;
}
