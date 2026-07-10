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

  it("detects self-hosted GitLab by hostname heuristic", () => {
    const target = detectPublishTargetFromRemote({
      name: "origin",
      url: "git@gitlab.company.com:team/app.git",
    });

    expect(target).toMatchObject({
      host: "gitlab",
      webBaseUrl: "https://gitlab.company.com",
      apiBaseUrl: "https://gitlab.company.com/api/v4",
      projectPath: "team/app",
    });
  });

  it("detects GitHub Enterprise with the /api/v3 base", () => {
    const target = detectPublishTargetFromRemote({
      name: "origin",
      url: "https://github.enterprise.io/acme/app.git",
    });

    expect(target).toMatchObject({
      host: "github",
      webBaseUrl: "https://github.enterprise.io",
      apiBaseUrl: "https://github.enterprise.io/api/v3",
      owner: "acme",
      repo: "app",
    });
  });

  it("honors SPEC_TO_PR_GIT_HOST override for unknown hosts", () => {
    const prev = process.env["SPEC_TO_PR_GIT_HOST"];
    process.env["SPEC_TO_PR_GIT_HOST"] = "gitlab";

    try {
      const target = detectPublishTargetFromRemote({
        name: "origin",
        url: "git@scm.internal:team/app.git",
      });

      expect(target).toMatchObject({ host: "gitlab", projectPath: "team/app" });
    } finally {
      if (prev === undefined) {
        delete process.env["SPEC_TO_PR_GIT_HOST"];
      } else {
        process.env["SPEC_TO_PR_GIT_HOST"] = prev;
      }
    }
  });
});
