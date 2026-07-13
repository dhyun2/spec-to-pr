import { describe, expect, it } from "vitest";

import { createInitialRun, RunManifestSchema } from "../../src/run/index.js";
import { runReviewPrechecks } from "../../src/review/review-precheck.js";
import { RUNTIME_CONTRACT_VERSION } from "../../src/runtime/constants.js";

describe("review prechecks", () => {
  it("flags open blocker gaps", () => {
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
      gaps: [
        {
          id: "gap_11111111111111111111111111111111",
          category: "api",
          severity: "blocker",
          status: "open",
          title: "Missing endpoint",
          expected: "Endpoint exists.",
          observed: "Endpoint missing.",
          impact: "Feature cannot be implemented.",
          sourceEvidenceIds: [],
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z",
        },
      ],
    });

    const findings = runReviewPrechecks({
      run,
      generatedAt: "2026-06-23T00:00:01.000Z",
    });

    expect(findings.some((finding) => finding.severity === "blocker")).toBe(true);
  });

  it("checks shared implementation evidence without inferring API or design agent identity", () => {
    const run = RunManifestSchema.parse({
      ...createInitialRun(
        { sources: [], baseCommit: "abcdef1" },
        {
          id: "run_11111111111111111111111111111111",
          pluginVersion: "0.1.0",
          projectRoot: "/tmp/project",
          now: "2026-06-23T00:00:00.000Z",
        },
      ),
      agentResults: [
        {
          schemaVersion: RUNTIME_CONTRACT_VERSION,
          id: "ar_11111111111111111111111111111111",
          runId: "run_11111111111111111111111111111111",
          kind: "implementation",
          agent: "implementation",
          status: "passed",
          baseSha: "abcdef1",
          commitSha: "abcdef1",
          changedFiles: ["src/features/reservation/api/fetch-reservations.ts"],
          evidenceIds: [],
          artifactIds: [],
          gapIds: [],
          checks: [],
          decisions: [],
          startedAt: "2026-06-23T00:00:00.000Z",
          completedAt: "2026-06-23T00:00:01.000Z",
        },
      ],
    });

    const findings = runReviewPrechecks({
      run,
      generatedAt: "2026-06-23T00:00:02.000Z",
    });

    expect(findings.map((finding) => finding.category)).toEqual(["implementation-claim"]);
  });

  it("flags legacy inventory without a feature coverage matrix", () => {
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
          kind: "legacy-feature-inventory",
          uri: "artifact://sha256/111",
          mediaType: "application/json",
          digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
          producedBy: "orchestrator",
          evidenceIds: [],
          createdAt: "2026-06-23T00:00:00.000Z",
          metadata: {
            reportKind: "legacy-feature-inventory-json",
            featureCount: 12,
          },
        },
      ],
    });

    const findings = runReviewPrechecks({
      run,
      generatedAt: "2026-06-23T00:00:02.000Z",
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "gap-policy",
          severity: "blocker",
          title: "Legacy feature coverage matrix is missing",
        }),
      ]),
    );
  });

  it("flags stale feature coverage matrix linked to a previous legacy inventory", () => {
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
          kind: "legacy-feature-inventory",
          uri: "artifact://sha256/111",
          mediaType: "application/json",
          digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
          producedBy: "orchestrator",
          evidenceIds: [],
          createdAt: "2026-06-23T00:00:00.000Z",
          metadata: {
            reportKind: "legacy-feature-inventory-json",
            featureCount: 10,
          },
        },
        {
          id: "art_22222222222222222222222222222222",
          kind: "feature-coverage-matrix",
          uri: "artifact://sha256/222",
          mediaType: "application/json",
          digest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
          producedBy: "orchestrator",
          evidenceIds: [],
          createdAt: "2026-06-23T00:00:01.000Z",
          metadata: {
            reportKind: "feature-coverage-matrix-json",
            inventoryArtifactId: "art_11111111111111111111111111111111",
            uncoveredCount: 0,
            documentedOnlyCount: 0,
          },
        },
        {
          id: "art_33333333333333333333333333333333",
          kind: "legacy-feature-inventory",
          uri: "artifact://sha256/333",
          mediaType: "application/json",
          digest: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
          producedBy: "orchestrator",
          evidenceIds: [],
          createdAt: "2026-06-23T00:00:02.000Z",
          metadata: {
            reportKind: "legacy-feature-inventory-json",
            featureCount: 12,
          },
        },
      ],
    });

    const findings = runReviewPrechecks({
      run,
      generatedAt: "2026-06-23T00:00:03.000Z",
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "gap-policy",
          severity: "blocker",
          title: "Legacy feature coverage matrix is stale",
          observed: expect.stringContaining("art_22222222222222222222222222222222"),
        }),
      ]),
    );
  });

  it("flags legacy coverage matrix with uncovered feature rows", () => {
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
          kind: "legacy-feature-inventory",
          uri: "artifact://sha256/111",
          mediaType: "application/json",
          digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
          producedBy: "orchestrator",
          evidenceIds: [],
          createdAt: "2026-06-23T00:00:00.000Z",
          metadata: {
            reportKind: "legacy-feature-inventory-json",
            featureCount: 2,
          },
        },
        {
          id: "art_22222222222222222222222222222222",
          kind: "feature-coverage-matrix",
          uri: "artifact://sha256/222",
          mediaType: "application/json",
          digest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
          producedBy: "orchestrator",
          evidenceIds: [],
          createdAt: "2026-06-23T00:00:01.000Z",
          metadata: {
            reportKind: "feature-coverage-matrix-json",
            inventoryArtifactId: "art_11111111111111111111111111111111",
            uncoveredCount: 1,
            documentedOnlyCount: 1,
          },
        },
      ],
    });

    const findings = runReviewPrechecks({
      run,
      generatedAt: "2026-06-23T00:00:02.000Z",
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "gap-policy",
          severity: "major",
          title: "Legacy feature coverage is incomplete",
        }),
      ]),
    );
  });
});
