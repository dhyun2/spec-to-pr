import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ execFileSync }));

import { readPublisherToken } from "../../src/publisher/token-provider.js";

describe("publisher token provider", () => {
  const originalGitlabToken = process.env.GITLAB_TOKEN;
  const originalGitlabPrivateToken = process.env.GITLAB_PRIVATE_TOKEN;

  beforeEach(() => {
    delete process.env.GITLAB_TOKEN;
    delete process.env.GITLAB_PRIVATE_TOKEN;
    execFileSync.mockReset();
  });

  afterEach(() => {
    restoreEnv("GITLAB_TOKEN", originalGitlabToken);
    restoreEnv("GITLAB_PRIVATE_TOKEN", originalGitlabPrivateToken);
  });

  it("passes a self-hosted GitLab hostname to the supported glab config command", () => {
    execFileSync.mockReturnValue("glpat-test-token\n");

    expect(readPublisherToken("gitlab", "gitlab.internal.example")).toEqual({
      token: "glpat-test-token",
      source: "glab config get token --host gitlab.internal.example",
    });
    expect(execFileSync).toHaveBeenCalledWith(
      "glab",
      ["config", "get", "token", "--host", "gitlab.internal.example"],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
