import { describe, expect, it } from "vitest";

import {
  createVisualLineage,
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
});
