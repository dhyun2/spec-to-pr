import { describe, expect, it } from "vitest";

import {
  renderPrBodyMarkdown,
  renderPrReportMarkdown,
} from "../../src/pr-report/pr-report-renderer.js";

describe("PR report renderer", () => {
  it("renders required sections", () => {
    const markdown = renderPrReportMarkdown({
      schemaVersion: "pr-report-v1",
      locale: "en",
      runId: "run_11111111111111111111111111111111",
      generatedAt: "2026-06-23T00:00:00.000Z",
      decision: "ready",
      title: "SpecToPR Report",
      summaryBullets: ["Generated from evidence."],
      runMetadata: {
        "Run ID": "run_11111111111111111111111111111111",
      },
      reviewGuide: ["Review gaps."],
      gateRows: [],
      scorecardRows: [],
      specificationLinks: [],
      traceabilityRows: [],
      traceabilityRowCount: 0,
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
      title: "SpecToPR Report",
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
      scorecardRows: [],
      specificationLinks: [],
      traceabilityRows: [],
      traceabilityRowCount: 0,
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

  it("renders a compact MR body with blockers first and no internal audit metadata", () => {
    const markdown = renderPrBodyMarkdown({
      schemaVersion: "pr-report-v1",
      locale: "ko",
      runId: "run_11111111111111111111111111111111",
      generatedAt: "2026-06-23T00:00:00.000Z",
      decision: "blocked",
      title: "SpecToPR Report",
      summaryBullets: ["증거 기반 구현 리포트를 생성했습니다."],
      runMetadata: {
        "Run ID": "run_11111111111111111111111111111111",
        "Project Root": "/tmp/project",
      },
      reviewGuide: ["게이트 요약과 결정을 먼저 확인합니다."],
      gateRows: [
        {
          gate: "OpenSpec / specification",
          required: true,
          status: "not-run",
          evidence: [
            "art_11111111111111111111111111111111",
            "art_22222222222222222222222222222222",
            "art_33333333333333333333333333333333",
          ],
          notes: "No openspec CheckResult was recorded.",
        },
      ],
      scorecardRows: [],
      specificationLinks: [],
      traceabilityRows: [],
      traceabilityRowCount: 0,
      changeScopeRows: [
        {
          Area: "figma-screenshot",
          "Artifact Count": "3",
          "Review Focus": "Design evidence and parity",
        },
      ],
      apiRows: [],
      functionalChecks: [],
      designChecks: [],
      figmaProviderRows: [
        {
          item: "Provider capability",
          status: "pass",
          artifacts: ["art_provider"],
          notes: "Recorded.",
        },
      ],
      figmaInventoryRows: [],
      visualRows: [],
      accessibilityChecks: [],
      performanceRows: [],
      observabilityChecks: [],
      runtimeChecks: [],
      gapSummaries: [
        {
          id: "gap_11111111111111111111111111111111",
          category: "traceability",
          severity: "blocker",
          status: "open",
          title: "Missing linked evidence",
          impact: "Cannot prove requirement coverage.",
        },
        {
          id: "gap_22222222222222222222222222222222",
          category: "traceability",
          severity: "blocker",
          status: "open",
          title: "Missing linked evidence",
          impact: "Cannot prove requirement coverage.",
        },
      ],
      archivePlan: [],
      reportArtifactIds: [],
    });

    expect(markdown).toContain("## 우선 확인할 실패 / 차단 사유");
    expect(markdown).toContain("머지 준비 상태");
    expect(markdown).toContain("요구사항 추적성: traceability matrix row가 0개입니다");
    expect(markdown).toContain("2개");
    expect(markdown).toContain("3개 증거");
    expect(markdown).not.toContain("<details>");
    expect(markdown).not.toContain("내부 audit 요약");
    expect(markdown).not.toContain("리포트 생성 시각");
    expect(markdown).not.toContain("run_11111111111111111111111111111111");
    expect(markdown).not.toContain("gap_11111111111111111111111111111111");
    expect(markdown).not.toContain("gap_22222222222222222222222222222222");
    expect(markdown).not.toContain("art_11111111111111111111111111111111");
    expect(markdown).not.toContain("## Figma 제공자 기능");
    expect(markdown).not.toContain("## 변경 범위");
    expect(markdown).not.toContain("추적성 매트릭스 행이 없습니다.");
  });

  it("uses traceability row count metadata when detailed rows are stored in artifacts", () => {
    const markdown = renderPrBodyMarkdown({
      schemaVersion: "pr-report-v1",
      locale: "ko",
      runId: "run_11111111111111111111111111111111",
      generatedAt: "2026-06-23T00:00:00.000Z",
      decision: "ready",
      title: "SpecToPR Report",
      summaryBullets: ["증거 기반 구현 리포트를 생성했습니다."],
      runMetadata: {},
      reviewGuide: [],
      gateRows: [],
      scorecardRows: [],
      specificationLinks: [],
      traceabilityRows: [],
      traceabilityRowCount: 12,
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
      archivePlan: [],
      reportArtifactIds: ["art_report"],
    });

    expect(markdown).not.toContain("traceability matrix row가 0개입니다");
    expect(markdown).not.toContain("내부 audit 요약");
  });

  it("renders review scorecard blockers in the compact PR body", () => {
    const markdown = renderPrBodyMarkdown({
      schemaVersion: "pr-report-v1",
      locale: "ko",
      runId: "run_11111111111111111111111111111111",
      generatedAt: "2026-06-23T00:00:00.000Z",
      decision: "blocked",
      title: "SpecToPR Report",
      summaryBullets: ["증거 기반 구현 리포트를 생성했습니다."],
      runMetadata: {},
      reviewGuide: [],
      gateRows: [
        {
          gate: "Review scorecard",
          required: true,
          status: "fail",
          evidence: ["art_scorecard"],
          notes: "Lowest review score 6.00 is below required 8.00; repair legacy-coverage next.",
        },
      ],
      scorecardRows: [
        {
          id: "legacy-coverage",
          label: "Legacy coverage",
          score: 6,
          threshold: 8,
          status: "fail",
          notes: "Two legacy features have no executed test evidence.",
          evidence: [],
          nextRepairTarget: true,
        },
        {
          id: "visual-parity",
          label: "Visual parity",
          score: 8.5,
          threshold: 8,
          status: "pass",
          notes: "Visual comparison meets the threshold.",
          evidence: [],
          nextRepairTarget: false,
        },
      ],
      specificationLinks: [],
      traceabilityRows: [],
      traceabilityRowCount: 12,
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
      archivePlan: [],
      reportArtifactIds: ["art_report"],
    });

    expect(markdown).toContain("## 리뷰 점수표");
    expect(markdown).toContain("Legacy coverage");
    expect(markdown).toContain("6.00");
    expect(markdown).toContain("다음 수정 대상");
  });
});
