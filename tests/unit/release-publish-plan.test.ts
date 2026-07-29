import { describe, expect, it } from "vitest";

import {
  buildReleasePublishPlan,
  parseReleasePublishArgs,
} from "../../src/release/release-publish-plan.js";

describe("release publish plan", () => {
  it("builds the full release publish command sequence", () => {
    const plan = buildReleasePublishPlan({
      version: "0.1.6",
      branch: "main",
      claudeMarketplace: "spec-to-pr",
      claudePlugin: "spec-to-pr@spec-to-pr",
      codexMarketplace: "spec-to-pr",
    });

    expect(plan.map((step) => step.id)).toEqual([
      "check",
      "reviewer-scheduling",
      "release-build",
      "git-tag",
      "git-push-release",
      "claude-marketplace-update",
      "claude-plugin-update",
      "codex-marketplace-upgrade",
    ]);
    expect(plan[1]).toMatchObject({
      command: "pnpm",
      args: ["reviewer-scheduling:check"],
    });
    expect(plan[2]).toMatchObject({
      command: "pnpm",
      args: ["release:build", "0.1.6", "--full"],
    });
    expect(plan[3]).toMatchObject({
      command: "git",
      args: ["tag", "--annotate", "spec-to-pr--v0.1.6", "--message", "spec-to-pr 0.1.6"],
    });
    expect(plan[4]).toMatchObject({
      command: "git",
      args: ["push", "origin", "main", "refs/tags/spec-to-pr--v0.1.6"],
    });
  });

  it("rejects non-semver versions before constructing mutating steps", () => {
    expect(() => buildReleasePublishPlan({ version: "next" })).toThrow(
      "Release version must be valid semver: next",
    );
  });

  it("supports verify-only and local update subsets", () => {
    expect(
      buildReleasePublishPlan({
        version: "0.1.6",
        verifyOnly: true,
      }).map((step) => step.id),
    ).toEqual(["check", "reviewer-scheduling", "release-build"]);

    expect(
      buildReleasePublishPlan({
        version: "0.1.6",
        localTarget: "codex",
        skipVerify: true,
        skipPush: true,
        skipTag: true,
      }).map((step) => step.id),
    ).toEqual(["codex-marketplace-upgrade"]);
  });

  it("parses CLI flags for dry-run release publishing", () => {
    expect(
      parseReleasePublishArgs([
        "--",
        "--version",
        "0.1.6",
        "--branch",
        "release",
        "--dry-run",
        "--skip-local-updates",
      ]),
    ).toMatchObject({
      version: "0.1.6",
      branch: "release",
      dryRun: true,
      skipLocalUpdates: true,
    });
  });
});
