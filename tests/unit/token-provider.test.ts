import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ execFileSync }));

import { readPublisherToken } from "../../src/publisher/token-provider.js";

describe("publisher token provider", () => {
  const originalGithubToken = process.env.GITHUB_TOKEN;
  const originalGhToken = process.env.GH_TOKEN;
  const originalGitlabToken = process.env.GITLAB_TOKEN;
  const originalGitlabPrivateToken = process.env.GITLAB_PRIVATE_TOKEN;

  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GITLAB_TOKEN;
    delete process.env.GITLAB_PRIVATE_TOKEN;
    execFileSync.mockReset();
  });

  afterEach(() => {
    restoreEnv("GITHUB_TOKEN", originalGithubToken);
    restoreEnv("GH_TOKEN", originalGhToken);
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

  it("passes an exact GitHub hostname to gh auth token", () => {
    execFileSync.mockReturnValue("ghp-test-token\n");

    expect(readPublisherToken("github", "github.internal.example")).toEqual({
      token: "ghp-test-token",
      source: "gh auth token --hostname github.internal.example",
    });
    expect(execFileSync).toHaveBeenCalledWith(
      "gh",
      ["auth", "token", "--hostname", "github.internal.example"],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it.each(["", "Usage: glab config get token [flags]\n\nFlags:\n  --help"])(
    "rejects unavailable GitLab CLI output: %j",
    (output) => {
      execFileSync.mockReturnValue(output);

      expect(() => readPublisherToken("gitlab", "gitlab.internal.example")).toThrow(
        /GitLab token is not configured/,
      );
    },
  );
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
