import { describe, expect, it } from "vitest";

import {
  createVisualLineage,
  latestVisualLineageOutcome,
  nextVisualAttempt,
} from "../../src/workflow/visual-repair-lineage.js";

const packet1 = { id: `packet_${"1".repeat(64)}` };
const packet2 = { id: `packet_${"2".repeat(64)}` };

describe("visual repair lineage", () => {
  it("carries attempts across repaired packets", () => {
    const first = createVisualLineage(undefined, packet1);
    const repaired = createVisualLineage(
      {
        lineageId: first.lineageId,
        attempts: 1,
        repairRequired: true,
        sourcePacketId: packet1.id,
      },
      packet2,
    );

    expect(repaired).toMatchObject({
      lineageId: first.lineageId,
      packetId: packet2.id,
      attempts: 1,
      nextAttempt: 2,
    });
  });

  it("does not consume attempts for acquisition failures", () => {
    expect(nextVisualAttempt({ attempts: [], acquisitionValid: false })).toBeUndefined();
  });

  it("stops after three valid comparisons", () => {
    expect(
      nextVisualAttempt({
        attempts: [{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }],
        acquisitionValid: true,
      }),
    ).toBeUndefined();
  });

  it("uses the first missing contiguous numeric attempt", () => {
    expect(
      nextVisualAttempt({
        attempts: [{ attempt: 2 }, { attempt: 2 }],
        acquisitionValid: true,
      }),
    ).toBe(1);
  });

  it("does not reopen repair after the highest committed lineage outcome is exhausted", () => {
    const lineageId = packet1.id;

    expect(
      latestVisualLineageOutcome(
        [
          {
            lineageId,
            sourcePacketId: packet1.id,
            attempt: 1,
            status: "repair-required",
            repairEvidenceArtifactId: `art_${"1".repeat(32)}`,
          },
          {
            lineageId,
            sourcePacketId: packet2.id,
            attempt: 3,
            status: "exhausted",
            repairEvidenceArtifactId: `art_${"3".repeat(32)}`,
          },
        ],
        lineageId,
      ),
    ).toMatchObject({
      sourcePacketId: packet2.id,
      attempt: 3,
      status: "exhausted",
    });
  });

  it("rejects duplicate committed outcomes for one lineage attempt", () => {
    const outcome = {
      lineageId: packet1.id,
      sourcePacketId: packet1.id,
      attempt: 1 as const,
      status: "repair-required" as const,
      repairEvidenceArtifactId: `art_${"1".repeat(32)}`,
    };

    expect(() => latestVisualLineageOutcome([outcome, { ...outcome }], packet1.id)).toThrow(
      /duplicate.*attempt 1/i,
    );
  });
});
