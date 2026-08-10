import { describe, expect, it } from "vitest";

import {
  checkGitLabMrPreflight,
  parseGitLabRemote,
  type CommandRunner,
} from "../../scripts/lite/check-gitlab-mr.js";

describe("GitLab Draft MR preflight", () => {
  it("parses HTTPS and SSH remotes without retaining credentials", () => {
    expect(parseGitLabRemote("https://token@example.gitlab.com/group/app.git")).toMatchObject({
      host: "example.gitlab.com",
      projectPath: "group/app",
    });
    expect(parseGitLabRemote("git@gitlab.com:team/platform/app.git")).toMatchObject({
      host: "gitlab.com",
      projectPath: "team/platform/app",
    });
  });

  it("does not run a GitLab check for a known GitHub remote", async () => {
    const result = await checkGitLabMrPreflight(
      { projectRoot: "/project" },
      createRunner([ok("https://github.com/acme/app.git\n")]),
    );

    expect(result).toMatchObject({ status: "not-applicable", canCreateDraftMr: "not-applicable" });
  });

  it("blocks before work when the authenticated role is below Developer", async () => {
    const result = await checkGitLabMrPreflight(
      { projectRoot: "/project" },
      createRunner([
        ok("https://gitlab.com/group/app.git\n"),
        ok("glab version 1\n"),
        ok("authenticated\n"),
        ok(
          JSON.stringify({
            merge_requests_enabled: true,
            permissions: { project_access: { access_level: 20 } },
          }),
        ),
      ]),
    );

    expect(result.status).toBe("blocked");
    expect(result.checks.at(-1)).toMatchObject({ id: "permission", status: "blocked" });
    expect(result.nextSteps.join(" ")).toContain("Developer");
  });

  it("returns ready-to-attempt only after read-only project and MR API checks", async () => {
    const result = await checkGitLabMrPreflight(
      { projectRoot: "/project" },
      createRunner([
        ok("git@gitlab.example.com:group/app.git\n"),
        ok("glab version 1\n"),
        ok("authenticated\n"),
        ok(
          JSON.stringify({
            merge_requests_enabled: true,
            permissions: { group_access: { access_level: 30 } },
          }),
        ),
        ok("[]\n"),
      ]),
    );

    expect(result).toMatchObject({
      status: "ready-to-attempt",
      canCreateDraftMr: "not-guaranteed",
    });
    expect(result.checks.map((check) => check.id)).toEqual([
      "remote",
      "glab",
      "authentication",
      "project",
      "permission",
      "merge-requests",
    ]);
  });
});

function createRunner(
  results: { exitCode: number; stdout: string; stderr: string }[],
): CommandRunner {
  return async () => {
    const result = results.shift();
    if (result === undefined) throw new Error("Unexpected command");
    return result;
  };
}

function ok(stdout: string): { exitCode: number; stdout: string; stderr: string } {
  return { exitCode: 0, stdout, stderr: "" };
}
