import type {
  RequirementReviewVerdict,
  ReviewContradiction,
  ReviewCouncilResult,
  ReviewFinding,
} from "./review-model.js";

export function renderReviewCouncilReport(result: ReviewCouncilResult): string {
  return markdown([
    "# Review Council Report",
    "",
    "## Summary",
    "",
    result.summary,
    "",
    "## Finding Summary",
    "",
    `- Findings: ${result.findings.length}`,
    `- Requirement verdicts: ${result.requirementVerdicts.length}`,
    `- Contradictions: ${result.contradictions.length}`,
    `- New gap drafts: ${result.newGapDrafts.length}`,
    "",
    "## Findings",
    "",
    ...renderFindings(result.findings),
    "",
    "## Requirement Verdicts",
    "",
    ...renderRequirementVerdicts(result.requirementVerdicts),
    "",
    "## Contradictions",
    "",
    ...renderContradictions(result.contradictions),
    "",
    "## New Gap Drafts",
    "",
    ...(result.newGapDrafts.length === 0
      ? ["No new gap drafts."]
      : result.newGapDrafts.map(
          (gap) =>
            `- ${gap.severity.toUpperCase()} ${gap.category}: ${gap.title} (finding ${gap.findingId})`,
        )),
    "",
  ]);
}

function renderFindings(findings: ReviewFinding[]): string[] {
  if (findings.length === 0) {
    return ["No findings."];
  }

  return [
    "| Finding | Severity | Category | Status | Title |",
    "|---|---|---|---|---|",
    ...findings.map(
      (finding) =>
        `| ${finding.id} | ${finding.severity} | ${finding.category} | ${finding.status} | ${escapeTableCell(finding.title)} |`,
    ),
  ];
}

function renderRequirementVerdicts(verdicts: RequirementReviewVerdict[]): string[] {
  if (verdicts.length === 0) {
    return ["No requirement verdicts."];
  }

  return [
    "| Requirement | Verdict | Reason | Gaps | Findings |",
    "|---|---|---|---|---|",
    ...verdicts.map(
      (verdict) =>
        `| ${verdict.requirementId} | ${verdict.verdict} | ${escapeTableCell(verdict.reason)} | ${joinIds(verdict.gapIds)} | ${joinIds(verdict.findingIds)} |`,
    ),
  ];
}

function renderContradictions(contradictions: ReviewContradiction[]): string[] {
  if (contradictions.length === 0) {
    return ["No contradictions."];
  }

  return [
    "| Contradiction | Severity | Left | Right | Explanation |",
    "|---|---|---|---|---|",
    ...contradictions.map(
      (item) =>
        `| ${item.id} | ${item.severity} | ${escapeTableCell(item.left.summary)} | ${escapeTableCell(item.right.summary)} | ${escapeTableCell(item.explanation)} |`,
    ),
  ];
}

function joinIds(ids: string[]): string {
  return ids.length === 0 ? "-" : ids.join("<br>");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function markdown(lines: string[]): string {
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
