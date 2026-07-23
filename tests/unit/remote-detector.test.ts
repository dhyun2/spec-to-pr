import { describe, expect, it } from "vitest";

import {
  detectPublishTargetFromRemote,
  normalizeGitRemoteUrl,
  preflightPublishTarget,
} from "../../src/publisher/remote-detector.js";

describe("remote detector", () => {
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
        return { hostname: input.hostname, token: "secret-token" };
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

  it("rejects incomplete or cross-host self-hosted configuration", async () => {
    const remote = { name: "origin", url: "git@gitlab.golfzon.local:web/mobydick.git" };
    const auth = async () => ({
      hostname: "gitlab.golfzon.local",
      token: "secret-token",
    });
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
        async () => ({ hostname: "wrong.internal", token: "secret-token" }),
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
