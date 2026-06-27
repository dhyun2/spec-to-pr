import { describe, expect, it } from "vitest";

import { createInitialRun, RunManifestSchema } from "../../src/run/index.js";
import { RUNTIME_CONTRACT_VERSION } from "../../src/runtime/index.js";

const now = "2026-06-23T00:00:00.000Z";

const runId = "run_11111111111111111111111111111111";
const sourceId = "src_11111111111111111111111111111111";
const evidenceId = "ev_11111111111111111111111111111111";
const artifactId = "art_22222222222222222222222222222222";
const gapId = "gap_66666666666666666666666666666666";
const agentResultId = "ar_44444444444444444444444444444444";
const checkId = "chk_33333333333333333333333333333333";
const digest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function validRun() {
  return createInitialRun(
    {
      sources: [
        {
          id: sourceId,
          kind: "brief",
          locator: {
            type: "file",
            path: "docs/brief.md",
          },
          digest,
          capturedAt: now,
          metadata: {},
        },
      ],
    },
    {
      id: runId,
      pluginVersion: "0.1.0",
      projectRoot: "/tmp/project",
      now,
    },
  );
}

describe("Run aggregate", () => {
  it("creates an initial Run with all required stages", () => {
    const run = validRun();

    expect(run.status).toBe("created");
    expect(run.revision).toBe(0);
    expect(run.stages.length).toBeGreaterThan(10);
  });

  it("rejects missing stages", () => {
    const run = validRun();
    run.stages = run.stages.slice(1);

    expect(RunManifestSchema.safeParse(run).success).toBe(false);
  });

  it("rejects duplicate stages", () => {
    const run = validRun();
    run.stages = [run.stages[0]!, ...run.stages];

    expect(RunManifestSchema.safeParse(run).success).toBe(false);
  });

  it("rejects evidence that references an unknown source", () => {
    const run = validRun();

    run.evidence.push({
      id: evidenceId,
      sourceId: "src_22222222222222222222222222222222",
      location: {
        type: "file-lines",
        path: "docs/brief.md",
        startLine: 1,
        endLine: 2,
      },
      summary: "Unknown source",
      digest,
      capturedAt: now,
      metadata: {},
    });

    expect(RunManifestSchema.safeParse(run).success).toBe(false);
  });

  it("rejects artifacts that reference unknown evidence", () => {
    const run = validRun();

    run.artifacts.push({
      id: artifactId,
      kind: "screenshot",
      uri: "artifact://screenshot.png",
      mediaType: "image/png",
      digest,
      producedBy: "design-ui",
      evidenceIds: [evidenceId],
      createdAt: now,
      metadata: {},
    });

    expect(RunManifestSchema.safeParse(run).success).toBe(false);
  });

  it("accepts linked source evidence artifact gap and agent result", () => {
    const run = validRun();

    run.evidence.push({
      id: evidenceId,
      sourceId,
      location: {
        type: "file-lines",
        path: "docs/brief.md",
        startLine: 1,
        endLine: 2,
      },
      summary: "Reservation policy",
      digest,
      capturedAt: now,
      metadata: {},
    });

    run.artifacts.push({
      id: artifactId,
      kind: "test-report",
      uri: "artifact://test-report.json",
      mediaType: "application/json",
      digest,
      producedBy: "design-ui",
      evidenceIds: [evidenceId],
      createdAt: now,
      metadata: {},
    });

    run.gaps.push({
      id: gapId,
      category: "api",
      severity: "major",
      status: "open",
      title: "Missing endpoint",
      expected: "Endpoint should exist.",
      observed: "Endpoint not found.",
      impact: "Feature cannot be fully implemented.",
      sourceEvidenceIds: [evidenceId],
      createdAt: now,
      updatedAt: now,
      resolutionArtifactIds: [],
      waiver: undefined,
    });

    run.agentResults.push({
      schemaVersion: RUNTIME_CONTRACT_VERSION,
      id: agentResultId,
      runId,
      kind: "implementation",
      agent: "design-ui",
      status: "passed",
      baseSha: "abcdef1",
      commitSha: "1234567",
      changedFiles: ["src/features/reservation/ui.tsx"],
      evidenceIds: [evidenceId],
      artifactIds: [artifactId],
      gapIds: [],
      checks: [
        {
          id: checkId,
          name: "component tests",
          kind: "component",
          status: "passed",
          exitCode: 0,
          reportArtifactId: artifactId,
          summary: "Component tests passed.",
        },
      ],
      decisions: [],
      startedAt: now,
      completedAt: "2026-06-23T00:00:01.000Z",
    });

    expect(RunManifestSchema.safeParse(run).success).toBe(true);
  });
});
