import { describe, expect, it } from "vitest";

import { collectPrReportViewModel } from "../../src/pr-report/pr-report-collector.js";
import { createInitialRun } from "../../src/run/index.js";
import { RunManifestSchema } from "../../src/run/run.js";

describe("PR report collector", () => {
  it("summarizes run checks and gaps into a view model", () => {
    const run = RunManifestSchema.parse({
      ...createInitialRun(
        { sources: [] },
        {
          id: "run_11111111111111111111111111111111",
          pluginVersion: "0.1.0",
          projectRoot: "/tmp/project",
          now: "2026-06-23T00:00:00.000Z",
        },
      ),
      artifacts: [
        {
          id: "art_11111111111111111111111111111111",
          kind: "openspec",
          uri: "artifact://sha256/111",
          mediaType: "text/markdown",
          digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
          producedBy: "orchestrator",
          evidenceIds: [],
          createdAt: "2026-06-23T00:00:00.000Z",
          metadata: {
            changeName: "reservation-flow",
          },
        },
      ],
      gaps: [
        {
          id: "gap_11111111111111111111111111111111",
          category: "api",
          severity: "major",
          status: "open",
          title: "Missing API detail",
          expected: "API details exist",
          observed: "API details missing",
          impact: "Reviewer must confirm behavior.",
          sourceEvidenceIds: [],
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
        },
      ],
      agentResults: [
        {
          schemaVersion: "2.0.0",
          id: "ar_11111111111111111111111111111111",
          runId: "run_11111111111111111111111111111111",
          kind: "verification",
          agent: "functional-reviewer",
          status: "passed",
          baseSha: "0000000",
          changedFiles: [],
          evidenceIds: [],
          artifactIds: ["art_11111111111111111111111111111111"],
          gapIds: [],
          checks: [
            {
              id: "chk_11111111111111111111111111111111",
              name: "typecheck",
              kind: "typecheck",
              status: "passed",
              exitCode: 0,
              summary: "Typecheck passed.",
            },
          ],
          decisions: [],
          startedAt: "2026-06-23T00:00:00.000Z",
          completedAt: "2026-06-23T00:00:01.000Z",
        },
      ],
    });

    const model = collectPrReportViewModel({
      run,
      generatedAt: "2026-06-23T00:00:02.000Z",
    });

    expect(model.decision).toBe("blocked");
    expect(model.specificationLinks).toHaveLength(1);
    expect(model.runtimeChecks[0]).toMatchObject({
      name: "typecheck",
      status: "pass",
    });
    expect(model.gapSummaries).toHaveLength(1);
  });

  it("requires OpenSpec but marks UI-only gates not applicable for instruction-only scope", () => {
    const run = RunManifestSchema.parse({
      ...createInitialRun(
        {
          sources: [
            {
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
            },
          ],
        },
        {
          id: "run_22222222222222222222222222222222",
          pluginVersion: "0.1.0",
          projectRoot: "/tmp/project",
          now: "2026-06-23T00:00:00.000Z",
        },
      ),
      artifacts: [
        {
          id: "art_22222222222222222222222222222222",
          kind: "test-report",
          uri: "artifact://sha256/222",
          mediaType: "application/json",
          digest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
          producedBy: "functional-reviewer",
          evidenceIds: [],
          createdAt: "2026-06-23T00:00:00.000Z",
          metadata: {
            reportKind: "verification-report",
          },
        },
      ],
      agentResults: [
        {
          schemaVersion: "2.0.0",
          id: "ar_22222222222222222222222222222222",
          runId: "run_22222222222222222222222222222222",
          kind: "verification",
          agent: "functional-reviewer",
          status: "passed",
          baseSha: "0000000",
          changedFiles: [],
          evidenceIds: [],
          artifactIds: ["art_22222222222222222222222222222222"],
          gapIds: [],
          checks: [
            check("chk_11111111111111111111111111111111", "lint"),
            check("chk_22222222222222222222222222222222", "typecheck"),
            check("chk_33333333333333333333333333333333", "build"),
            check("chk_44444444444444444444444444444444", "unit"),
          ],
          decisions: [],
          startedAt: "2026-06-23T00:00:00.000Z",
          completedAt: "2026-06-23T00:00:01.000Z",
        },
      ],
    });

    const model = collectPrReportViewModel({
      run,
      generatedAt: "2026-06-23T00:00:02.000Z",
    });

    expect(model.decision).toBe("blocked");
    expect(model.gateRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "OpenSpec / specification",
          required: true,
          status: "not-run",
        }),
        expect.objectContaining({
          gate: "Accessibility",
          required: false,
          status: "not-applicable",
        }),
        expect.objectContaining({
          gate: "Performance / Web Vitals",
          required: false,
          status: "not-applicable",
        }),
        expect.objectContaining({
          gate: "Observability",
          required: false,
          status: "not-applicable",
        }),
      ]),
    );
  });

  it("surfaces failed legacy-vs-target visual comparison artifacts in the gate and visual rows", () => {
    const run = RunManifestSchema.parse({
      ...createInitialRun(
        { sources: [] },
        {
          id: "run_33333333333333333333333333333333",
          pluginVersion: "0.1.0",
          projectRoot: "/tmp/project",
          now: "2026-06-23T00:00:00.000Z",
        },
      ),
      artifacts: [
        {
          id: "art_33333333333333333333333333333333",
          kind: "figma-screenshot",
          uri: "artifact://sha256/333",
          mediaType: "image/png",
          digest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
          producedBy: "orchestrator",
          evidenceIds: [],
          createdAt: "2026-06-23T00:00:00.000Z",
          metadata: {},
        },
        {
          id: "art_44444444444444444444444444444444",
          kind: "visual-report",
          uri: "artifact://sha256/444",
          mediaType: "application/json",
          digest: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
          producedBy: "orchestrator",
          evidenceIds: [],
          createdAt: "2026-06-23T00:00:01.000Z",
          metadata: {
            reportKind: "visual-review-result",
            visualEvidenceRole: "comparison-report",
            comparisonMode: "legacy-vs-target",
            comparisonBaseline: "legacy",
            comparisonActual: "target",
            changeName: "mapfinder-default",
            decision: "failed",
            reviewMatch: 96.4,
            threshold: 97,
          },
        },
      ],
    });

    const model = collectPrReportViewModel({
      run,
      generatedAt: "2026-06-23T00:00:02.000Z",
    });
    const visualGate = model.gateRows.find((row) => row.gate === "Visual regression");

    expect(visualGate).toMatchObject({
      status: "fail",
      evidence: ["art_44444444444444444444444444444444"],
    });
    expect(model.visualRows).toEqual([
      expect.objectContaining({
        state: "mapfinder-default",
        result: "fail",
        reviewMatch: 96.4,
        notes: expect.stringContaining("legacy-vs-target"),
      }),
    ]);
  });

  it("summarizes traceability row counts from matrix artifact metadata", () => {
    const run = RunManifestSchema.parse({
      ...createInitialRun(
        { sources: [] },
        {
          id: "run_44444444444444444444444444444444",
          pluginVersion: "0.1.0",
          projectRoot: "/tmp/project",
          now: "2026-06-23T00:00:00.000Z",
        },
      ),
      artifacts: [
        {
          id: "art_55555555555555555555555555555555",
          kind: "traceability-matrix",
          uri: "artifact://sha256/555",
          mediaType: "application/json",
          digest: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
          producedBy: "orchestrator",
          evidenceIds: [],
          createdAt: "2026-06-23T00:00:00.000Z",
          metadata: {
            adapter: "evidence-graph-v1",
            rowCount: 7,
          },
        },
      ],
    });

    const model = collectPrReportViewModel({
      run,
      generatedAt: "2026-06-23T00:00:02.000Z",
    });

    expect(model.traceabilityRowCount).toBe(7);
  });

  it("uses latest checks in gate rows and hides superseded quality-gate gaps", () => {
    const run = RunManifestSchema.parse({
      ...createInitialRun(
        {
          sources: [
            {
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
            },
          ],
        },
        {
          id: "run_55555555555555555555555555555555",
          pluginVersion: "0.1.0",
          projectRoot: "/tmp/project",
          now: "2026-06-23T00:00:00.000Z",
        },
      ),
      artifacts: [
        {
          id: "art_66666666666666666666666666666666",
          kind: "test-report",
          uri: "artifact://sha256/666",
          mediaType: "application/json",
          digest: "sha256:6666666666666666666666666666666666666666666666666666666666666666",
          producedBy: "functional-reviewer",
          evidenceIds: [],
          createdAt: "2026-06-23T00:05:00.000Z",
          metadata: {
            reportKind: "quality-gate-report",
          },
        },
        {
          id: "art_88888888888888888888888888888888",
          kind: "review-scorecard",
          uri: "artifact://sha256/888",
          mediaType: "application/json",
          digest: "sha256:8888888888888888888888888888888888888888888888888888888888888888",
          producedBy: "functional-reviewer",
          evidenceIds: [],
          createdAt: "2026-06-23T00:05:01.000Z",
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
        },
      ],
      gaps: [
        {
          id: "gap_33333333333333333333333333333333",
          category: "implementation",
          severity: "blocker",
          status: "open",
          title: "Quality gate failed: build",
          expected: "build quality gate should pass.",
          observed: "Command exited with code 2.",
          impact: "Failed quality gates block reliable verification and publishing.",
          sourceEvidenceIds: [],
          owner: "implementation",
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
          metadata: {
            checkId: "chk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            checkKind: "build",
            checkName: "build",
          },
        },
      ],
      agentResults: [
        {
          schemaVersion: "2.0.0",
          id: "ar_33333333333333333333333333333333",
          runId: "run_55555555555555555555555555555555",
          kind: "verification",
          agent: "functional-reviewer",
          status: "failed",
          baseSha: "0000000",
          changedFiles: [],
          evidenceIds: [],
          artifactIds: [],
          gapIds: ["gap_33333333333333333333333333333333"],
          checks: [
            {
              id: "chk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              name: "build",
              kind: "build",
              status: "failed",
              exitCode: 2,
              summary: "build failed.",
              failureReason: "Command exited with code 2.",
            },
          ],
          decisions: [],
          startedAt: "2026-06-23T00:00:00.000Z",
          completedAt: "2026-06-23T00:00:01.000Z",
        },
        {
          schemaVersion: "2.0.0",
          id: "ar_44444444444444444444444444444444",
          runId: "run_55555555555555555555555555555555",
          kind: "verification",
          agent: "functional-reviewer",
          status: "passed",
          baseSha: "0000000",
          changedFiles: [],
          evidenceIds: [],
          artifactIds: ["art_66666666666666666666666666666666"],
          gapIds: [],
          checks: [
            check("chk_11111111111111111111111111111111", "lint"),
            check("chk_22222222222222222222222222222222", "typecheck"),
            check("chk_33333333333333333333333333333333", "build"),
            check("chk_44444444444444444444444444444444", "unit"),
            {
              id: "chk_55555555555555555555555555555555",
              name: "openspec",
              kind: "openspec",
              status: "passed",
              exitCode: 0,
              summary: "openspec passed.",
            },
          ],
          decisions: [],
          startedAt: "2026-06-23T00:05:00.000Z",
          completedAt: "2026-06-23T00:05:01.000Z",
        },
      ],
    });

    const model = collectPrReportViewModel({
      run,
      generatedAt: "2026-06-23T00:00:02.000Z",
    });
    const runtimeGate = model.gateRows.find((row) => row.gate === "Runtime verification");

    expect(model.decision).toBe("ready");
    expect(runtimeGate).toMatchObject({
      status: "pass",
    });
    expect(model.gapSummaries).toEqual([]);
  });

  it("surfaces review scorecard rows as a required blocking gate", () => {
    const run = RunManifestSchema.parse({
      ...createInitialRun(
        {
          sources: [
            {
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
            },
          ],
        },
        {
          id: "run_66666666666666666666666666666666",
          pluginVersion: "0.1.0",
          projectRoot: "/tmp/project",
          now: "2026-06-23T00:00:00.000Z",
        },
      ),
      artifacts: [
        {
          id: "art_77777777777777777777777777777777",
          kind: "review-scorecard",
          uri: "artifact://sha256/777",
          mediaType: "application/json",
          digest: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
          producedBy: "functional-reviewer",
          evidenceIds: [],
          createdAt: "2026-06-23T00:06:00.000Z",
          metadata: {
            reportKind: "review-scorecard-json",
            minimumScore: 8,
            lowestScore: 6,
            decision: "retry",
            nextRepairTarget: "legacy-coverage",
            dimensions: [
              {
                id: "legacy-coverage",
                label: "Legacy coverage",
                score: 6,
                threshold: 8,
                status: "fail",
                notes: "Two legacy features have no executed test evidence.",
              },
              {
                id: "visual-parity",
                label: "Visual parity",
                score: 8.5,
                threshold: 8,
                status: "pass",
                notes: "Visual comparison meets the threshold.",
              },
            ],
          },
        },
      ],
      agentResults: [
        {
          schemaVersion: "2.0.0",
          id: "ar_55555555555555555555555555555555",
          runId: "run_66666666666666666666666666666666",
          kind: "verification",
          agent: "functional-reviewer",
          status: "passed",
          baseSha: "0000000",
          changedFiles: [],
          evidenceIds: [],
          artifactIds: ["art_77777777777777777777777777777777"],
          gapIds: [],
          checks: [
            check("chk_11111111111111111111111111111111", "lint"),
            check("chk_22222222222222222222222222222222", "typecheck"),
            check("chk_33333333333333333333333333333333", "build"),
            check("chk_44444444444444444444444444444444", "unit"),
            {
              id: "chk_55555555555555555555555555555555",
              name: "openspec",
              kind: "openspec",
              status: "passed",
              exitCode: 0,
              summary: "openspec passed.",
            },
          ],
          decisions: [],
          startedAt: "2026-06-23T00:06:00.000Z",
          completedAt: "2026-06-23T00:06:01.000Z",
        },
      ],
    });

    const model = collectPrReportViewModel({
      run,
      generatedAt: "2026-06-23T00:00:02.000Z",
    });

    expect(model.decision).toBe("blocked");
    expect(model.scorecardRows).toEqual([
      expect.objectContaining({
        id: "legacy-coverage",
        score: 6,
        threshold: 8,
        status: "fail",
        nextRepairTarget: true,
      }),
      expect.objectContaining({
        id: "visual-parity",
        score: 8.5,
        status: "pass",
        nextRepairTarget: false,
      }),
    ]);
    expect(model.gateRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "Review scorecard",
          required: true,
          status: "fail",
          evidence: ["art_77777777777777777777777777777777"],
          notes: "Lowest review score 6.00 is below required 8.00; repair legacy-coverage next.",
        }),
      ]),
    );
  });
});

function check(id: string, kind: "lint" | "typecheck" | "build" | "unit") {
  return {
    id,
    name: kind,
    kind,
    status: "passed" as const,
    exitCode: 0,
    summary: `${kind} passed.`,
  };
}
