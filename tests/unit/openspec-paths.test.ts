import { describe, expect, it } from "vitest";

import {
  resolveOpenSpecChangePaths,
  toOpenSpecChangeName,
} from "../../src/openspec/openspec-paths.js";

describe("OpenSpec paths", () => {
  it("normalizes change names", () => {
    expect(toOpenSpecChangeName("Deliver Reservation Management")).toBe(
      "deliver-reservation-management",
    );
  });

  it("rejects unsafe change names", () => {
    expect(() => toOpenSpecChangeName("../evil")).toThrow();
  });

  it("resolves change paths", () => {
    const paths = resolveOpenSpecChangePaths({
      projectRoot: "/repo",
      changeName: "deliver-reservation-management",
    });

    expect(paths.proposalPath).toBe(
      "/repo/openspec/changes/deliver-reservation-management/proposal.md",
    );
  });
});
