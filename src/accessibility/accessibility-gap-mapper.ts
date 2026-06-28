import { GapSchema } from "../runtime/gap.js";
import { createGapId } from "../runtime/id-factory.js";
import type { Gap } from "../runtime/gap.js";
import type { AccessibilityViolation, AutomatedAccessibilityCheck } from "./accessibility-model.js";

export function mapAccessibilityChecksToGaps(input: {
  checks: AutomatedAccessibilityCheck[];
  createdAt: string;
}): Gap[] {
  return input.checks.flatMap((check) =>
    check.violations
      .filter((violation) => shouldBecomeGap(violation))
      .map((violation) =>
        GapSchema.parse({
          id: createGapId(),
          category: "accessibility",
          severity: severityFromImpact(violation.impact),
          status: "open",
          title: `Accessibility violation: ${violation.id}`,
          expected:
            "The implemented UI should satisfy automated accessibility checks for the target state.",
          observed: describeViolation(violation),
          impact: impactDescription(violation),
          sourceEvidenceIds: check.evidenceIds,
          owner: "evidence-verifier",
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
          metadata: {
            checkId: check.id,
            targetId: check.targetId,
            violationId: violation.id,
            impact: violation.impact,
            wcagTags: violation.wcagTags,
          },
        }),
      ),
  );
}

function shouldBecomeGap(violation: AccessibilityViolation): boolean {
  return ["critical", "serious", "moderate"].includes(violation.impact);
}

function severityFromImpact(impact: AccessibilityViolation["impact"]) {
  switch (impact) {
    case "critical":
      return "blocker";
    case "serious":
      return "major";
    case "moderate":
      return "minor";
    case "minor":
      return "info";
  }
}

function describeViolation(violation: AccessibilityViolation): string {
  const target = violation.target.length === 0 ? "unknown target" : violation.target.join(", ");

  return `${violation.help} at ${target}${
    violation.failureSummary === undefined ? "" : `: ${violation.failureSummary}`
  }`;
}

function impactDescription(violation: AccessibilityViolation): string {
  return `This may affect users relying on keyboard navigation, screen readers, sufficient contrast, or semantic structure. Impact level: ${violation.impact}.`;
}
