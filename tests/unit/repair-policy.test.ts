import { describe, expect, it } from "vitest";

import { defaultRepairPolicy } from "../../src/integration/repair-policy.js";

describe("repair policy", () => {
  it("defines allowed and forbidden repair actions", () => {
    const policy = defaultRepairPolicy();

    expect(policy.maxAttempts).toBe(2);
    expect(policy.allowedChangePatterns).toContain("fix-import-paths");
    expect(policy.forbiddenActions).toContain("add-undocumented-endpoint");
  });
});
