import type { CheckResult } from "../runtime/check.js";
import type { Gap } from "../runtime/gap.js";
import type { ReportDecision } from "./pr-report-model.js";

const MANDATORY_CHECK_KINDS = [
  "lint",
  "typecheck",
  "build",
  "unit",
  "component",
  "contract",
  "openspec",
] as const;

export function decideReportStatus(input: { checks: CheckResult[]; gaps: Gap[] }): ReportDecision {
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
