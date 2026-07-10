import { describe, expect, it } from "vitest";

import { classifyCommand } from "../../src/security/command-policy.js";

describe("classifyCommand", () => {
  it("allows read-only git commands", () => {
    const result = classifyCommand({
      command: "git",
      args: ["status", "--short"],
      intent: "git-read",
    });

    expect(result.decision.verdict).toBe("allow");
  });

  it("requires approval for git write commands", () => {
    const result = classifyCommand({
      command: "git",
      args: ["commit", "-m", "test"],
      intent: "git-write",
    });

    expect(result.decision.verdict).toBe("requires_approval");
  });

  it("denies shell executables", () => {
    const result = classifyCommand({
      command: "bash",
      args: ["-lc", "echo hi"],
      intent: "unknown",
    });

    expect(result.decision.verdict).toBe("deny");
  });

  it("denies shell metacharacters in arguments", () => {
    const result = classifyCommand({
      command: "pnpm",
      args: ["test", "&&", "rm", "-rf", "/"],
      intent: "test",
    });

    expect(result.decision.verdict).toBe("deny");
  });

  it("requires approval for dependency installation", () => {
    const result = classifyCommand({
      command: "pnpm",
      args: ["install"],
      intent: "install",
    });

    expect(result.decision.verdict).toBe("requires_approval");
  });
});
