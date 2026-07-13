import { describe, expect, it } from "vitest";

import { getAgentFileOwnershipPolicy } from "../../src/agent-runtime/file-ownership-policy.js";

describe("agent file ownership policy", () => {
  it("uses one implementation policy for API, UI, tests, and application wiring", () => {
    const policy = getAgentFileOwnershipPolicy("implementation");

    expect(policy.write.map((rule) => rule.pattern)).toContain("src/**");
    expect(policy.write.map((rule) => rule.pattern)).toContain("tests/**");
    expect(policy.forbidden.map((rule) => rule.pattern)).not.toContain(
      "src/shared/api/generated/**",
    );
  });
});
