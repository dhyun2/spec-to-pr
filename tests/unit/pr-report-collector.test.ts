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
          schemaVersion: "0.1.0",
          id: "ar_11111111111111111111111111111111",
          runId: "run_11111111111111111111111111111111",
          kind: "verification",
          agent: "evidence-verifier",
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

  it("marks UI-only gates not applicable for instruction-only docs scope", () => {
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
          producedBy: "evidence-verifier",
          evidenceIds: [],
          createdAt: "2026-06-23T00:00:00.000Z",
          metadata: {
            reportKind: "verification-report",
          },
        },
      ],
      agentResults: [
        {
          schemaVersion: "0.1.0",
          id: "ar_22222222222222222222222222222222",
          runId: "run_22222222222222222222222222222222",
          kind: "verification",
          agent: "evidence-verifier",
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

    expect(model.decision).toBe("ready");
    expect(model.gateRows).toEqual(
      expect.arrayContaining([
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
