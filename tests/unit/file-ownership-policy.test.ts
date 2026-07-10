import { describe, expect, it } from "vitest";

import { getAgentFileOwnershipPolicy } from "../../src/agent-runtime/file-ownership-policy.js";

describe("agent file ownership policy", () => {
  it("allows API agents to write API wrappers while forbidding page UI", () => {
    const policy = getAgentFileOwnershipPolicy("api-contract");

    expect(policy.write.map((rule) => rule.pattern)).toContain("src/features/**/api/**");
    expect(policy.forbidden.map((rule) => rule.pattern)).toContain("src/pages/**/ui/**");
  });

  it("allows design agents to write UI while forbidding generated API output", () => {
    const policy = getAgentFileOwnershipPolicy("design-ui");

    expect(policy.write.map((rule) => rule.pattern)).toContain("src/features/**/ui/**");
    expect(policy.forbidden.map((rule) => rule.pattern)).toContain("src/shared/api/generated/**");
  });

  it("keeps integrator write access focused on public wiring boundaries", () => {
    const policy = getAgentFileOwnershipPolicy("integrator");

    expect(policy.write.map((rule) => rule.pattern)).toContain("src/app/**");
    expect(policy.forbidden.map((rule) => rule.pattern)).toContain("src/shared/api/generated/**");
  });
});
