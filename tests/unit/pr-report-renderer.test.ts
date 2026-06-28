import { describe, expect, it } from "vitest";

import { renderPrReportMarkdown } from "../../src/pr-report/pr-report-renderer.js";

describe("PR report renderer", () => {
  it("renders required sections", () => {
    const markdown = renderPrReportMarkdown({
      schemaVersion: "pr-report-v1",
      runId: "run_11111111111111111111111111111111",
      generatedAt: "2026-06-23T00:00:00.000Z",
      decision: "ready",
      title: "Spec to PR Report",
      summaryBullets: ["Generated from evidence."],
      runMetadata: {
        "Run ID": "run_11111111111111111111111111111111",
      },
      reviewGuide: ["Review gaps."],
      specificationLinks: [],
      traceabilityRows: [],
      changeScopeRows: [],
      apiRows: [],
      functionalChecks: [],
      designChecks: [],
      visualRows: [],
      accessibilityChecks: [],
      performanceRows: [],
      observabilityChecks: [],
      runtimeChecks: [],
      gapSummaries: [],
      archivePlan: ["Archive after merge."],
      reportArtifactIds: [],
    });

    expect(markdown).toContain("# Summary");
    expect(markdown).toContain("## Run Metadata");
    expect(markdown).toContain("## Screenshot Compare");
    expect(markdown).toContain("## Network Verification");
    expect(markdown).toContain("## Gaps And Review Notes");
    expect(markdown).toContain("## Decision");
  });
});
