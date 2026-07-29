import { describe, expect, it } from "vitest";

import { runConcurrentOrdered } from "../browser/case4-parallel.mjs";

describe("Case 4 concurrent runner", () => {
  it("starts independent work before awaiting it and preserves declared result order", async () => {
    const started: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const result = runConcurrentOrdered([
      async () => {
        started.push("first");
        await firstGate;
        return "first-result";
      },
      async () => {
        started.push("second");
        return "second-result";
      },
    ]);

    expect(started).toEqual(["first", "second"]);
    releaseFirst?.();
    await expect(result).resolves.toEqual(["first-result", "second-result"]);
  });
});
