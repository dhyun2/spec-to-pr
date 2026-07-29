import { describe, expect, it } from "vitest";

import { buildReviewerSchedulingCases } from "../../benchmarks/runtime/collect-reviewer-scheduling-decision.js";

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
});
