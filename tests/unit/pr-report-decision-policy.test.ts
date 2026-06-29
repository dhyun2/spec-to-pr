import { describe, expect, it } from "vitest";

import { decideReportStatus } from "../../src/pr-report/pr-report-decision-policy.js";
import type { ArtifactRef, CheckResult, Gap } from "../../src/runtime/index.js";

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
      artifacts: [observabilityArtifact()],
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
      artifacts: [observabilityArtifact()],
    });

    expect(decision).toBe("draft");
  });

  it("marks reports ready when every required nonvisual gate is recorded", () => {
    const decision = decideReportStatus({
      checks: requiredChecks(),
      gaps: [],
      artifacts: [observabilityArtifact()],
    });

    expect(decision).toBe("ready");
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
