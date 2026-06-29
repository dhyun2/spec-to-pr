import { describe, expect, it } from "vitest";

import { renderPrReportMarkdown } from "../../src/pr-report/pr-report-renderer.js";

describe("PR report renderer", () => {
  it("renders required sections", () => {
    const markdown = renderPrReportMarkdown({
      schemaVersion: "pr-report-v1",
      locale: "en",
      runId: "run_11111111111111111111111111111111",
      generatedAt: "2026-06-23T00:00:00.000Z",
      decision: "ready",
      title: "Spec to PR Report",
      summaryBullets: ["Generated from evidence."],
      runMetadata: {
        "Run ID": "run_11111111111111111111111111111111",
      },
      reviewGuide: ["Review gaps."],
      gateRows: [],
      specificationLinks: [],
      traceabilityRows: [],
      changeScopeRows: [],
      apiRows: [],
      functionalChecks: [],
      designChecks: [],
      figmaProviderRows: [],
      figmaInventoryRows: [],
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
    expect(markdown).toContain("## Gate Summary");
    expect(markdown).toContain("## Figma Provider Capability");
    expect(markdown).toContain("## Figma Design-System Inventory");
    expect(markdown).toContain("## Screenshot Compare");
    expect(markdown).toContain("## Network Verification");
    expect(markdown).toContain("## Gaps And Review Notes");
    expect(markdown).toContain("## Decision");
  });

  it("renders reviewer-facing Korean report sections", () => {
    const markdown = renderPrReportMarkdown({
      schemaVersion: "pr-report-v1",
      locale: "ko",
      runId: "run_11111111111111111111111111111111",
      generatedAt: "2026-06-23T00:00:00.000Z",
      decision: "blocked",
      title: "Spec to PR Report",
      summaryBullets: ["증거 기반 구현 리포트를 생성했습니다."],
      runMetadata: {
        "Run ID": "run_11111111111111111111111111111111",
      },
      reviewGuide: ["게이트 요약과 결정을 먼저 확인합니다."],
      gateRows: [
        {
          gate: "Performance / Web Vitals",
          required: true,
          status: "not-run",
          evidence: [],
          notes: "No performance report artifact was recorded.",
        },
      ],
      specificationLinks: [],
      traceabilityRows: [],
      changeScopeRows: [],
      apiRows: [],
      functionalChecks: [],
      designChecks: [],
      figmaProviderRows: [],
      figmaInventoryRows: [],
      visualRows: [],
      accessibilityChecks: [],
      performanceRows: [],
      observabilityChecks: [],
      runtimeChecks: [],
      gapSummaries: [],
      archivePlan: ["머지 후 OpenSpec archive를 실행합니다."],
      reportArtifactIds: [],
    });

    expect(markdown).toContain("# 요약");
    expect(markdown).toContain("## 게이트 요약");
    expect(markdown).toContain("## 성능 / Web Vitals");
    expect(markdown).toContain("성능 리포트 artifact가 기록되지 않았습니다.");
    expect(markdown).toContain("## 결정");
    expect(markdown).toContain("머지 준비 상태");
  });
});
