import { describe, expect, it } from "vitest";

import { SecurityHardeningRunner } from "../../src/release/index.js";

describe("security hardening runner", () => {
  it("records release hardening fixtures", async () => {
    const runner = new SecurityHardeningRunner(() => "2026-06-28T00:00:00.000Z");
    const report = await runner.run();

    expect(report.status).toBe("passed");
    expect(report.findings.map((finding) => finding.category)).toEqual(
      expect.arrayContaining(["prompt-injection", "path-traversal", "unsafe-package-content"]),
    );
    expect(report.findings.every((finding) => finding.status === "passed")).toBe(true);
  });
});
