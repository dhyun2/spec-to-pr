import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildReviewerSchedulingCases,
  collectReviewerSchedulingDecision,
  serializeReviewerSchedulingDecision,
} from "../../benchmarks/runtime/collect-reviewer-scheduling-decision.js";

describe("reviewer scheduling decision collector", () => {
  it("defines 30 distinct delivery cases and 35 distinct packet fixtures with pass and repair", () => {
    // Catches collapsing the measurement back to one repeated PNG pair or a pass-only workload.
    const cases = buildReviewerSchedulingCases();
    const packetFixtures = cases.flatMap((sample) => sample.packetFixtures);

    expect(cases).toHaveLength(30);
    expect(new Set(cases.map((sample) => sample.sampleId))).toHaveLength(30);
    expect(packetFixtures).toHaveLength(35);
    expect(new Set(packetFixtures.map((fixture) => fixture.fixtureDigest))).toHaveLength(35);
    expect(
      packetFixtures.filter((fixture) => fixture.expectedVisualStatus === "failed"),
    ).toHaveLength(5);
    expect(
      packetFixtures.filter((fixture) => fixture.expectedVisualStatus === "passed"),
    ).toHaveLength(30);
    expect(
      cases
        .filter((sample) => sample.firstAttemptFails)
        .every(
          (sample) =>
            sample.packetFixtures.length === 2 &&
            sample.packetFixtures[0]?.expectedVisualStatus === "failed" &&
            sample.packetFixtures[1]?.expectedVisualStatus === "passed",
        ),
    ).toBe(true);
  });

  it("drives real workflow packets and regenerates the sanitized aggregate byte-for-byte", async () => {
    // Catches synthetic metric emission, host-timer drift, missing repair invalidation, and
    // a collector that cannot reproduce the committed decision artifact.
    const result = await collectReviewerSchedulingDecision();
    const serialized = serializeReviewerSchedulingDecision(result.artifact);
    const committed = await readFile(
      path.resolve("benchmarks/runtime/reviewer-scheduling-decision.json"),
      "utf8",
    );

    expect(result.diagnostics.deliverySampleCount).toBe(30);
    expect(result.diagnostics.packetCount).toBe(35);
    expect(new Set(result.diagnostics.packetDigests)).toHaveLength(35);
    expect(new Set(result.diagnostics.fixtureDigests)).toHaveLength(35);
    expect(result.diagnostics.numericStatuses).toEqual({ passed: 30, failed: 5 });
    expect(result.diagnostics.repairableFailureCount).toBe(5);
    expect(result.diagnostics.preVisualFunctionalActionCount).toBe(35);
    expect(result.artifact.aggregates).toMatchObject({
      sampleSize: 35,
      deliverySampleCount: 30,
      numericVisualResultCount: 35,
      firstAttemptVisualFailures: 5,
      firstAttemptVisualFailureRate: 1 / 6,
      reviewerWallStartedBeforeVisualStabilityMs: 850,
      totalReviewerWallMs: 1390,
      invalidatedReviewerWallMs: 100,
      invalidationRatio: 100 / 1390,
      passToBothReviewsWallMs: {
        total: 900,
        mean: 30,
        p50: 30,
        p95: 30,
      },
    });
    expect(result.artifact.decisionRule).toMatchObject({
      sampleSizeGatePassed: true,
      invalidationRatioGatePassed: false,
      selectedStablePacketScheduling: false,
      decision: "retain-current-parallel-scheduling",
      speedupClaim: "none",
    });
    expect(serialized).toBe(committed);
    expect(serialized).not.toMatch(
      /token|authorization|password|https?:\/\/|\/Users\/|packet_[a-f0-9]{64}|run_[a-f0-9]{32}/i,
    );
  }, 120_000);
});
