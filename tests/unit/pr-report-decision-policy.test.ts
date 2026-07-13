import { describe, expect, it } from "vitest";

import { decideReportStatus } from "../../src/pr-report/pr-report-decision-policy.js";
import type { ArtifactRef, CheckResult, Gap, SourceRef } from "../../src/runtime/index.js";

describe("PR report decision policy", () => {
  it("blocks when no verification checks have run", () => {
    const decision = decideReportStatus({
      checks: [],
      gaps: [],
      artifacts: [],
    });

    expect(decision).toBe("blocked");
  });

  it("blocks on mandatory check failure", () => {
    const decision = decideReportStatus({
      checks: [
        {
          id: "chk_11111111111111111111111111111111",
          name: "typecheck",
          kind: "typecheck",
          status: "failed",
          failureReason: "Type error",
          summary: "Typecheck failed",
        },
      ],
      gaps: [],
      artifacts: [],
    });

    expect(decision).toBe("blocked");
  });

  it("uses the latest check per kind so rerun passes supersede earlier failures", () => {
    const decision = decideReportStatus({
      checks: [
        {
          id: "chk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          name: "build",
          kind: "build",
          status: "failed",
          exitCode: 2,
          failureReason: "Build failed before dependency install.",
          summary: "build failed.",
          completedAt: "2026-06-23T00:00:00.000Z",
          startedAt: "2026-06-23T00:00:00.000Z",
        },
        passedCheck("chk_11111111111111111111111111111111", "lint"),
        passedCheck("chk_22222222222222222222222222222222", "typecheck"),
        {
          ...passedCheck("chk_33333333333333333333333333333333", "build"),
          completedAt: "2026-06-23T00:05:00.000Z",
          startedAt: "2026-06-23T00:05:00.000Z",
        },
        passedCheck("chk_44444444444444444444444444444444", "unit"),
        passedCheck("chk_55555555555555555555555555555555", "openspec"),
      ],
      gaps: [],
      artifacts: [passedReviewScorecardArtifact()],
      sources: [instructionSource()],
    });

    expect(decision).toBe("ready");
  });

  it("ignores superseded quality-gate gaps when the latest check passed", () => {
    const decision = decideReportStatus({
      checks: [
        passedCheck("chk_11111111111111111111111111111111", "lint"),
        passedCheck("chk_22222222222222222222222222222222", "typecheck"),
        passedCheck("chk_33333333333333333333333333333333", "build"),
        passedCheck("chk_44444444444444444444444444444444", "unit"),
        passedCheck("chk_55555555555555555555555555555555", "openspec"),
      ],
      gaps: [
        {
          ...majorGap(),
          severity: "blocker",
          category: "implementation",
          title: "Quality gate failed: build",
          metadata: {
            checkId: "chk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            checkKind: "build",
            checkName: "build",
          },
        },
      ],
      artifacts: [passedReviewScorecardArtifact()],
      sources: [instructionSource()],
    });

    expect(decision).toBe("ready");
  });

  it("blocks when runtime verification is missing typecheck even if lint and build passed", () => {
    const decision = decideReportStatus({
      checks: [
        passedCheck("chk_11111111111111111111111111111111", "lint"),
        passedCheck("chk_22222222222222222222222222222222", "build"),
        passedCheck("chk_33333333333333333333333333333333", "unit"),
        passedCheck("chk_44444444444444444444444444444444", "openspec"),
        passedCheck("chk_55555555555555555555555555555555", "accessibility"),
        passedCheck("chk_66666666666666666666666666666666", "performance"),
        passedCheck("chk_77777777777777777777777777777777", "security"),
      ],
      gaps: [],
      artifacts: [observabilityArtifact(), passedReviewScorecardArtifact()],
    });

    expect(decision).toBe("blocked");
  });

  it("blocks when required verification gates are not recorded", () => {
    const decision = decideReportStatus({
      checks: [
        passedCheck("chk_11111111111111111111111111111111", "lint"),
        passedCheck("chk_22222222222222222222222222222222", "typecheck"),
        passedCheck("chk_33333333333333333333333333333333", "build"),
        passedCheck("chk_44444444444444444444444444444444", "unit"),
        passedCheck("chk_55555555555555555555555555555555", "openspec"),
      ],
      gaps: [],
      artifacts: [],
    });

    expect(decision).toBe("blocked");
  });

  it("blocks on open blocker gaps", () => {
    const decision = decideReportStatus({
      checks: [],
      gaps: [
        {
          id: "gap_11111111111111111111111111111111",
          category: "api",
          severity: "blocker",
          status: "open",
          title: "Missing API",
          expected: "API exists",
          observed: "API missing",
          impact: "Cannot implement",
          sourceEvidenceIds: [],
          resolutionArtifactIds: [],
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
          metadata: {},
        },
      ],
      artifacts: [],
    });

    expect(decision).toBe("blocked");
  });

  it("drafts on open major gaps", () => {
    const decision = decideReportStatus({
      checks: requiredChecks(),
      gaps: [majorGap()],
      artifacts: [observabilityArtifact(), passedReviewScorecardArtifact()],
    });

    expect(decision).toBe("draft");
  });

  it("marks reports ready when every required nonvisual gate is recorded", () => {
    const decision = decideReportStatus({
      checks: requiredChecks(),
      gaps: [],
      artifacts: [observabilityArtifact(), passedReviewScorecardArtifact()],
    });

    expect(decision).toBe("ready");
  });

  it("requires OpenSpec for natural-language-only runs", () => {
    const decision = decideReportStatus({
      checks: [
        passedCheck("chk_11111111111111111111111111111111", "lint"),
        passedCheck("chk_22222222222222222222222222222222", "typecheck"),
        passedCheck("chk_33333333333333333333333333333333", "build"),
        passedCheck("chk_44444444444444444444444444444444", "unit"),
      ],
      gaps: [],
      artifacts: [passedReviewScorecardArtifact()],
      sources: [instructionSource()],
    });

    expect(decision).toBe("blocked");
  });

  it("marks instruction-only runs ready after OpenSpec when no UI security or observability intent exists", () => {
    const decision = decideReportStatus({
      checks: [
        passedCheck("chk_11111111111111111111111111111111", "lint"),
        passedCheck("chk_22222222222222222222222222222222", "typecheck"),
        passedCheck("chk_33333333333333333333333333333333", "build"),
        passedCheck("chk_44444444444444444444444444444444", "unit"),
        passedCheck("chk_55555555555555555555555555555555", "openspec"),
      ],
      gaps: [],
      artifacts: [passedReviewScorecardArtifact()],
      sources: [instructionSource()],
    });

    expect(decision).toBe("ready");
  });

  it("requires security and observability gates from parsed request intent before evidence exists", () => {
    const decision = decideReportStatus({
      checks: [
        passedCheck("chk_11111111111111111111111111111111", "lint"),
        passedCheck("chk_22222222222222222222222222222222", "typecheck"),
        passedCheck("chk_33333333333333333333333333333333", "build"),
        passedCheck("chk_44444444444444444444444444444444", "unit"),
        passedCheck("chk_55555555555555555555555555555555", "openspec"),
      ],
      gaps: [],
      artifacts: [
        parsedIntakeArtifact({
          security: true,
          observability: true,
        }),
      ],
      sources: [instructionSource()],
    });

    expect(decision).toBe("blocked");
  });

  it("blocks Figma-backed reports when visual comparison has not run", () => {
    const decision = decideReportStatus({
      checks: requiredChecks(),
      gaps: [],
      artifacts: [
        {
          id: "art_11111111111111111111111111111111",
          kind: "figma-screenshot",
          uri: "artifact://sha256/111",
          mediaType: "image/png",
          digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
          producedBy: "orchestrator",
          evidenceIds: [],
          createdAt: "2026-06-23T00:00:00.000Z",
          metadata: {},
        },
      ],
    });

    expect(decision).toBe("blocked");
  });

  it("requires Figma inventory and visual comparison for Figma-backed reports", () => {
    const decision = decideReportStatus({
      checks: [...requiredChecks(), passedCheck("chk_88888888888888888888888888888888", "visual")],
      gaps: [],
      artifacts: [
        figmaArtifact("art_11111111111111111111111111111111", "figma-screenshot"),
        visualReportArtifact(),
        observabilityArtifact(),
      ],
    });

    expect(decision).toBe("blocked");
  });

  it("accepts legacy-vs-target visual comparison artifacts as visual evidence", () => {
    const decision = decideReportStatus({
      checks: requiredChecks(),
      gaps: [],
      artifacts: [
        figmaArtifact("art_11111111111111111111111111111111", "figma-mcp-capability-report"),
        figmaArtifact("art_22222222222222222222222222222222", "figma-design-inventory"),
        figmaArtifact("art_33333333333333333333333333333333", "figma-design-contract"),
        figmaArtifact("art_44444444444444444444444444444444", "figma-screenshot"),
        legacyVisualComparisonArtifact("passed"),
        observabilityArtifact(),
        passedReviewScorecardArtifact(),
      ],
    });

    expect(decision).toBe("ready");
  });

  it("accepts legacy screenshot baseline metadata as visual comparison evidence", () => {
    const decision = decideReportStatus({
      checks: requiredChecks(),
      gaps: [],
      artifacts: [
        figmaArtifact("art_11111111111111111111111111111111", "figma-mcp-capability-report"),
        figmaArtifact("art_22222222222222222222222222222222", "figma-design-inventory"),
        figmaArtifact("art_33333333333333333333333333333333", "figma-design-contract"),
        figmaArtifact("art_44444444444444444444444444444444", "figma-screenshot"),
        legacyBaselineVisualComparisonArtifact(),
        observabilityArtifact(),
        passedReviewScorecardArtifact(),
      ],
    });

    expect(decision).toBe("ready");
  });

  it("blocks component-contract Figma work until component-level visual evidence is recorded", () => {
    const decision = decideReportStatus({
      checks: requiredChecks(),
      gaps: [],
      artifacts: [
        figmaArtifact("art_11111111111111111111111111111111", "figma-mcp-capability-report"),
        figmaArtifact("art_22222222222222222222222222222222", "figma-design-inventory"),
        componentContractArtifact(),
        figmaArtifact("art_44444444444444444444444444444444", "figma-screenshot"),
        visualReportArtifact(),
        observabilityArtifact(),
      ],
    });

    expect(decision).toBe("blocked");
  });

  it("accepts component-level visual artifacts for component contracts", () => {
    const decision = decideReportStatus({
      checks: requiredChecks(),
      gaps: [],
      artifacts: [
        figmaArtifact("art_11111111111111111111111111111111", "figma-mcp-capability-report"),
        figmaArtifact("art_22222222222222222222222222222222", "figma-design-inventory"),
        componentContractArtifact(),
        figmaArtifact("art_44444444444444444444444444444444", "figma-screenshot"),
        visualReportArtifact(),
        componentVisualReportArtifact("passed"),
        observabilityArtifact(),
        passedReviewScorecardArtifact(),
      ],
    });

    expect(decision).toBe("ready");
  });

  it("marks failed component-level visual artifacts as needing review", () => {
    const decision = decideReportStatus({
      checks: requiredChecks(),
      gaps: [],
      artifacts: [
        figmaArtifact("art_11111111111111111111111111111111", "figma-mcp-capability-report"),
        figmaArtifact("art_22222222222222222222222222222222", "figma-design-inventory"),
        componentContractArtifact(),
        figmaArtifact("art_44444444444444444444444444444444", "figma-screenshot"),
        visualReportArtifact(),
        componentVisualReportArtifact("failed"),
        observabilityArtifact(),
        passedReviewScorecardArtifact(),
      ],
    });

    expect(decision).toBe("ready-after-review");
  });

  it("marks failed legacy-vs-target visual comparisons as needing review", () => {
    const decision = decideReportStatus({
      checks: requiredChecks(),
      gaps: [],
      artifacts: [
        figmaArtifact("art_11111111111111111111111111111111", "figma-mcp-capability-report"),
        figmaArtifact("art_22222222222222222222222222222222", "figma-design-inventory"),
        figmaArtifact("art_33333333333333333333333333333333", "figma-design-contract"),
        figmaArtifact("art_44444444444444444444444444444444", "figma-screenshot"),
        legacyVisualComparisonArtifact("failed"),
        observabilityArtifact(),
        passedReviewScorecardArtifact(),
      ],
    });

    expect(decision).toBe("ready-after-review");
  });

  it("blocks legacy migration reports when coverage matrix is missing", () => {
    const decision = decideReportStatus({
      checks: requiredChecks(),
      gaps: [],
      artifacts: [legacyInventoryArtifact(), observabilityArtifact()],
      sources: [instructionSource()],
    });

    expect(decision).toBe("blocked");
  });

  it("blocks legacy migration reports with uncovered feature coverage", () => {
    const decision = decideReportStatus({
      checks: requiredChecks(),
      gaps: [],
      artifacts: [
        legacyInventoryArtifact(),
        featureCoverageMatrixArtifact({
          uncoveredCount: 1,
          documentedOnlyCount: 1,
        }),
        observabilityArtifact(),
      ],
      sources: [instructionSource()],
    });

    expect(decision).toBe("blocked");
  });

  it("blocks reports when the latest publish result failed body or asset synchronization", () => {
    const decision = decideReportStatus({
      checks: requiredChecks(),
      gaps: [],
      artifacts: [failedPublishResultArtifact(), observabilityArtifact()],
      sources: [instructionSource()],
    });

    expect(decision).toBe("blocked");
  });

  it("blocks reports when the latest review scorecard has any dimension below threshold", () => {
    const decision = decideReportStatus({
      checks: requiredChecks(),
      gaps: [],
      artifacts: [
        reviewScorecardArtifact({ minimumScore: 8, lowestScore: 6.5 }),
        observabilityArtifact(),
      ],
      sources: [instructionSource()],
    });

    expect(decision).toBe("blocked");
  });
});

function requiredChecks(): CheckResult[] {
  return [
    passedCheck("chk_11111111111111111111111111111111", "lint"),
    passedCheck("chk_22222222222222222222222222222222", "typecheck"),
    passedCheck("chk_33333333333333333333333333333333", "build"),
    passedCheck("chk_44444444444444444444444444444444", "unit"),
    passedCheck("chk_55555555555555555555555555555555", "openspec"),
    passedCheck("chk_66666666666666666666666666666666", "accessibility"),
    passedCheck("chk_77777777777777777777777777777777", "performance"),
    passedCheck("chk_88888888888888888888888888888888", "security"),
  ];
}

function passedCheck(id: string, kind: CheckResult["kind"]): CheckResult {
  return {
    id,
    name: kind,
    kind,
    status: "passed",
    exitCode: 0,
    summary: `${kind} passed.`,
  };
}

function majorGap(): Gap {
  return {
    id: "gap_11111111111111111111111111111111",
    category: "design",
    severity: "major",
    status: "open",
    title: "Missing Figma state",
    expected: "State exists",
    observed: "State missing",
    impact: "Visual uncertainty",
    sourceEvidenceIds: [],
    resolutionArtifactIds: [],
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
    metadata: {},
  };
}

function observabilityArtifact(): ArtifactRef {
  return {
    id: "art_99999999999999999999999999999999",
    kind: "telemetry-config",
    uri: "artifact://sha256/999",
    mediaType: "application/json",
    digest: "sha256:9999999999999999999999999999999999999999999999999999999999999999",
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: "2026-06-23T00:00:00.000Z",
    metadata: {
      reportKind: "observability-report-json",
    },
  };
}

function componentContractArtifact(): ArtifactRef {
  return {
    id: "art_dddddddddddddddddddddddddddddddd",
    kind: "figma-design-contract",
    uri: "repo://openspec/changes/mapfinder/artifacts/design-contract/figma-design-contract.json",
    mediaType: "application/json",
    digest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: "2026-06-23T00:00:00.000Z",
    metadata: {
      changeName: "mapfinder",
      componentContractCount: 1,
    },
  };
}

function componentVisualReportArtifact(decision: "passed" | "failed"): ArtifactRef {
  return {
    id: "art_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    kind: "visual-report",
    uri: "artifact://sha256/eee",
    mediaType: "application/json",
    digest: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: "2026-06-23T00:00:00.000Z",
    metadata: {
      reportKind: "visual-report-json",
      comparisonScope: "component",
      componentContractId: "2252:5509",
      componentName: "StoreCard / Compact",
      decision,
      reviewMatch: decision === "passed" ? 0.982 : 0.91,
    },
  };
}

function visualReportArtifact(): ArtifactRef {
  return {
    id: "art_88888888888888888888888888888888",
    kind: "visual-report",
    uri: "artifact://sha256/888",
    mediaType: "application/json",
    digest: "sha256:8888888888888888888888888888888888888888888888888888888888888888",
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: "2026-06-23T00:00:00.000Z",
    metadata: {
      reportKind: "visual-report-json",
    },
  };
}

function legacyVisualComparisonArtifact(decision: "passed" | "failed"): ArtifactRef {
  return {
    id: "art_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    kind: "visual-report",
    uri: "artifact://sha256/bbb",
    mediaType: "application/json",
    digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: "2026-06-23T00:00:00.000Z",
    metadata: {
      reportKind: "visual-review-result",
      visualEvidenceRole: "comparison-report",
      comparisonMode: "legacy-vs-target",
      comparisonBaseline: "legacy",
      comparisonActual: "target",
      changeName: "mapfinder-default",
      decision,
    },
  };
}

function legacyBaselineVisualComparisonArtifact(): ArtifactRef {
  return {
    id: "art_cccccccccccccccccccccccccccccccc",
    kind: "visual-report",
    uri: "artifact://sha256/ccc",
    mediaType: "application/json",
    digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: "2026-06-23T00:00:00.000Z",
    metadata: {
      reportKind: "visual-review-result",
      visualBaseline: "legacy-screenshot",
      visualActual: "target-screenshot",
      changeName: "mapfinder-default",
      decision: "passed",
    },
  };
}

function legacyInventoryArtifact(): ArtifactRef {
  return {
    id: "art_f1111111111111111111111111111111",
    kind: "legacy-feature-inventory",
    uri: "artifact://sha256/f11",
    mediaType: "application/json",
    digest: "sha256:f111111111111111111111111111111111111111111111111111111111111111",
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: "2026-06-23T00:00:00.000Z",
    metadata: {
      reportKind: "legacy-feature-inventory-json",
      featureCount: 2,
    },
  };
}

function featureCoverageMatrixArtifact(input: {
  uncoveredCount: number;
  documentedOnlyCount: number;
}): ArtifactRef {
  return {
    id: "art_f2222222222222222222222222222222",
    kind: "feature-coverage-matrix",
    uri: "artifact://sha256/f22",
    mediaType: "application/json",
    digest: "sha256:f222222222222222222222222222222222222222222222222222222222222222",
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: "2026-06-23T00:00:01.000Z",
    metadata: {
      reportKind: "feature-coverage-matrix-json",
      inventoryArtifactId: "art_f1111111111111111111111111111111",
      uncoveredCount: input.uncoveredCount,
      documentedOnlyCount: input.documentedOnlyCount,
    },
  };
}

function failedPublishResultArtifact(): ArtifactRef {
  return {
    id: "art_f3333333333333333333333333333333",
    kind: "agent-result-report",
    uri: "artifact://sha256/f33",
    mediaType: "application/json",
    digest: "sha256:f333333333333333333333333333333333333333333333333333333333333333",
    producedBy: "pr-publisher",
    evidenceIds: [],
    createdAt: "2026-06-23T00:00:02.000Z",
    metadata: {
      reportKind: "publish-result",
      status: "failed",
      requestSynced: false,
      visualPreviewExpected: true,
      visualPreviewSynced: false,
    },
  };
}

function reviewScorecardArtifact(input: {
  minimumScore: number;
  lowestScore: number;
}): ArtifactRef {
  return {
    id: "art_f4444444444444444444444444444444",
    kind: "review-scorecard",
    uri: "artifact://sha256/f44",
    mediaType: "application/json",
    digest: "sha256:f444444444444444444444444444444444444444444444444444444444444444",
    producedBy: "functional-reviewer",
    evidenceIds: [],
    createdAt: "2026-06-23T00:00:03.000Z",
    metadata: {
      reportKind: "review-scorecard-json",
      minimumScore: input.minimumScore,
      lowestScore: input.lowestScore,
      decision: "retry",
      nextRepairTarget: "tdd-evidence",
      dimensions: [
        {
          id: "tdd-evidence",
          label: "TDD evidence",
          score: input.lowestScore,
          threshold: input.minimumScore,
          status: "fail",
          notes: "Scenario tests did not show red-green execution evidence.",
        },
      ],
    },
  };
}

function passedReviewScorecardArtifact(): ArtifactRef {
  return {
    id: "art_f5555555555555555555555555555555",
    kind: "review-scorecard",
    uri: "artifact://sha256/f55",
    mediaType: "application/json",
    digest: "sha256:f555555555555555555555555555555555555555555555555555555555555555",
    producedBy: "functional-reviewer",
    evidenceIds: [],
    createdAt: "2026-06-23T00:00:04.000Z",
    metadata: {
      reportKind: "review-scorecard-json",
      minimumScore: 8,
      lowestScore: 8,
      decision: "passed",
      dimensions: [
        {
          id: "tdd-evidence",
          label: "TDD evidence",
          score: 8,
          threshold: 8,
          status: "warning",
          notes: "Executable test evidence meets the minimum score.",
        },
      ],
    },
  };
}

function instructionSource(): SourceRef {
  return {
    id: "src_11111111111111111111111111111111",
    kind: "instruction",
    locator: {
      type: "inline",
      label: "user-request",
      mediaType: "text/plain; charset=utf-8",
    },
    digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    capturedAt: "2026-06-23T00:00:00.000Z",
    metadata: {},
  };
}

function parsedIntakeArtifact(gatePolicy: {
  security?: boolean;
  observability?: boolean;
}): ArtifactRef {
  return {
    id: "art_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    kind: "parsed-intake-request",
    uri: "artifact://sha256/aaa",
    mediaType: "application/json",
    digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: "2026-06-23T00:00:00.000Z",
    metadata: {
      parserVersion: "intake-request-parser-v1",
      gatePolicy,
    },
  };
}

function figmaArtifact(id: string, kind: ArtifactRef["kind"]): ArtifactRef {
  return {
    id,
    kind,
    uri: "artifact://sha256/111",
    mediaType: kind === "figma-screenshot" ? "image/png" : "application/json",
    digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    producedBy: "orchestrator",
    evidenceIds: [],
    createdAt: "2026-06-23T00:00:00.000Z",
    metadata: {},
  };
}
