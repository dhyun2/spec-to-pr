import { describe, expect, it } from "vitest";

import { loadPlaywrightChromium } from "../../src/visual/browser-capture-runner.js";

describe("browser capture runner", () => {
  it("turns a missing Playwright dependency into an actionable runtime error", async () => {
    const missingPlaywrightError = Object.assign(
      new Error(
        "Cannot find package 'playwright' imported from /tmp/spec-to-pr/dist/mcp/server.js",
      ),
      {
        code: "ERR_MODULE_NOT_FOUND",
      },
    );

    await expect(
      loadPlaywrightChromium(async () => {
        throw missingPlaywrightError;
      }),
    ).rejects.toThrow("Playwright is required for visual screenshot capture but is not available");
  });
});
