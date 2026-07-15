import { describe, expect, it } from "vitest";

import {
  detectPublishTargetFromRemote,
  normalizeGitRemoteUrl,
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
});
