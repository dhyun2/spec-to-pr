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
});
