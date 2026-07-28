import { afterEach, describe, expect, it, vi } from "vitest";

const childProcess = vi.hoisted(() => ({ execFile: vi.fn() }));

vi.mock("node:child_process", () => childProcess);

import {
  detectPublishTargetFromRemote,
  normalizeGitRemoteUrl,
  preflightPublishTarget,
} from "../../src/publisher/remote-detector.js";

describe("remote detector", () => {
  afterEach(() => {
    childProcess.execFile.mockReset();
  });
  it("parses GitHub SSH remotes", () => {
    const target = detectPublishTargetFromRemote({
      name: "origin",
      url: "git@github.com:acme/spec-to-pr.git",
    });

    expect(target).toMatchObject({
      host: "github",
      owner: "acme",
      repo: "spec-to-pr",
    });
  });

  it("parses GitLab HTTPS remotes with group path", () => {
    const target = detectPublishTargetFromRemote({
      name: "origin",
      url: "https://gitlab.com/acme/platform/spec-to-pr.git",
    });

    expect(target).toMatchObject({
      host: "gitlab",
      projectPath: "acme/platform/spec-to-pr",
    });
  });

  it("normalizes ssh URLs", () => {
    expect(normalizeGitRemoteUrl("ssh://git@github.com/acme/repo.git")).toEqual({
      host: "github.com",
      pathParts: ["acme", "repo"],
    });
  });

  it.each(["https://github.attacker.test/acme/app.git", "git@gitlab.attacker.test:team/app.git"])(
    "rejects provider-lookalike remotes without an explicit override: %s",
    (url) => {
      const previous = process.env["SPEC_TO_PR_GIT_HOST"];
      delete process.env["SPEC_TO_PR_GIT_HOST"];
      try {
        expect(() =>
          detectPublishTargetFromRemote({
            name: "origin",
            url,
          }),
        ).toThrow(/Unsupported Git remote host/);
      } finally {
        if (previous === undefined) delete process.env["SPEC_TO_PR_GIT_HOST"];
        else process.env["SPEC_TO_PR_GIT_HOST"] = previous;
      }
    },
  );

  it("honors SPEC_TO_PR_GIT_HOST override for unknown hosts", () => {
    const prev = process.env["SPEC_TO_PR_GIT_HOST"];
    process.env["SPEC_TO_PR_GIT_HOST"] = "gitlab";

    try {
      const target = detectPublishTargetFromRemote({
        name: "origin",
        url: "git@scm.internal:team/app.git",
      });

      expect(target).toMatchObject({
        host: "gitlab",
        webBaseUrl: "https://scm.internal",
        apiBaseUrl: "https://scm.internal/api/v4",
        projectPath: "team/app",
      });
    } finally {
      if (prev === undefined) {
        delete process.env["SPEC_TO_PR_GIT_HOST"];
      } else {
        process.env["SPEC_TO_PR_GIT_HOST"] = prev;
      }
    }
  });

  it("preflights a self-hosted GitLab target with exact-host auth", async () => {
    const probes: Array<{ provider: string; hostname: string }> = [];
    const result = await preflightPublishTarget(
      { name: "origin", url: "git@gitlab.golfzon.local:web/mobydick.git" },
      {
        SPEC_TO_PR_GIT_HOST: "gitlab",
        SPEC_TO_PR_WEB_BASE_URL: "https://gitlab.golfzon.local",
        SPEC_TO_PR_API_BASE_URL: "https://gitlab.golfzon.local/api/v4",
      },
      async (input) => {
        probes.push(input);
        return { available: true, source: "test" };
      },
    );

    expect(result.public).toMatchObject({
      host: "gitlab",
      webBaseUrl: "https://gitlab.golfzon.local",
      apiBaseUrl: "https://gitlab.golfzon.local/api/v4",
      projectPath: "web/mobydick",
    });
    expect(result).not.toHaveProperty("token");
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(probes).toEqual([{ provider: "gitlab", hostname: "gitlab.golfzon.local" }]);
  });

  it("uses the exact-host GitLab credential command and never exposes its token", async () => {
    const token = "glpat-keyring-token";
    childProcess.execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, { stdout: `${token}\n` });
    });

    const result = await preflightPublishTarget(
      { name: "origin", url: "git@gitlab.internal.example:team/app.git" },
      {
        SPEC_TO_PR_GIT_HOST: "gitlab",
        SPEC_TO_PR_WEB_BASE_URL: "https://gitlab.internal.example",
        SPEC_TO_PR_API_BASE_URL: "https://gitlab.internal.example/api/v4",
      },
    );

    expect(childProcess.execFile).toHaveBeenCalledWith(
      "glab",
      ["config", "get", "token", "--host", "gitlab.internal.example"],
      expect.objectContaining({ encoding: "utf8" }),
      expect.any(Function),
    );
    expect(result).toEqual({
      public: expect.objectContaining({ host: "gitlab", projectPath: "team/app" }),
      remoteHost: "gitlab.internal.example",
      authVerified: true,
    });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it.each(["", "Usage: glab config get token [flags]\n\nFlags:\n  --help"])(
    "treats unavailable GitLab CLI output as an unauthenticated preflight: %j",
    async (output) => {
      childProcess.execFile.mockImplementation((_command, _args, _options, callback) => {
        callback(null, { stdout: output });
      });

      await expect(
        preflightPublishTarget(
          { name: "origin", url: "git@gitlab.internal.example:team/app.git" },
          {
            SPEC_TO_PR_GIT_HOST: "gitlab",
            SPEC_TO_PR_WEB_BASE_URL: "https://gitlab.internal.example",
            SPEC_TO_PR_API_BASE_URL: "https://gitlab.internal.example/api/v4",
          },
        ),
      ).rejects.toThrow(/authentication must resolve the exact remote hostname/);
    },
  );

  it("rejects incomplete or cross-host self-hosted configuration", async () => {
    const remote = { name: "origin", url: "git@gitlab.golfzon.local:web/mobydick.git" };
    const auth = async () => ({ available: true, source: "test" });
    await expect(
      preflightPublishTarget(
        remote,
        {
          SPEC_TO_PR_GIT_HOST: "gitlab",
          SPEC_TO_PR_WEB_BASE_URL: "https://gitlab.golfzon.local",
        },
        auth,
      ),
    ).rejects.toThrow(/SPEC_TO_PR_API_BASE_URL/);
    await expect(
      preflightPublishTarget(
        remote,
        {
          SPEC_TO_PR_GIT_HOST: "gitlab",
          SPEC_TO_PR_WEB_BASE_URL: "https://attacker.test",
          SPEC_TO_PR_API_BASE_URL: "https://gitlab.golfzon.local/api/v4",
        },
        auth,
      ),
    ).rejects.toThrow(/exact remote hostname/);
    await expect(
      preflightPublishTarget(
        remote,
        {
          SPEC_TO_PR_GIT_HOST: "gitlab",
          SPEC_TO_PR_WEB_BASE_URL: "https://gitlab.golfzon.local",
          SPEC_TO_PR_API_BASE_URL: "https://gitlab.golfzon.local/api/v4",
        },
        async () => ({ available: false, source: "test" }),
      ),
    ).rejects.toThrow(/exact remote hostname/);
  });

  it("redacts auth probe failures", async () => {
    await expect(
      preflightPublishTarget(
        { name: "origin", url: "git@gitlab.golfzon.local:web/mobydick.git" },
        {
          SPEC_TO_PR_GIT_HOST: "gitlab",
          SPEC_TO_PR_WEB_BASE_URL: "https://gitlab.golfzon.local",
          SPEC_TO_PR_API_BASE_URL: "https://gitlab.golfzon.local/api/v4",
        },
        async () => {
          throw new Error("probe failed with secret-token");
        },
      ),
    ).rejects.not.toThrow(/secret-token/);
  });
});
