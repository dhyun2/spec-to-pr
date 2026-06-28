import { describe, expect, it } from "vitest";

import { createInitialRun, RunManifestSchema } from "../../src/run/index.js";
import { runReviewPrechecks } from "../../src/review/review-precheck.js";

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

  it("flags passed API and Design/UI results without required evidence", () => {
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
          schemaVersion: "0.1.0",
          id: "ar_11111111111111111111111111111111",
          runId: "run_11111111111111111111111111111111",
          kind: "implementation",
          agent: "api-contract",
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
        {
          schemaVersion: "0.1.0",
          id: "ar_22222222222222222222222222222222",
          runId: "run_11111111111111111111111111111111",
          kind: "implementation",
          agent: "design-ui",
          status: "passed",
          baseSha: "abcdef1",
          commitSha: "abcdef1",
          changedFiles: ["src/features/reservation/ui/reservation-list.tsx"],
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

    expect(findings.map((finding) => finding.category)).toEqual(
      expect.arrayContaining(["implementation-claim", "api-contract", "design-contract"]),
    );
  });
});
