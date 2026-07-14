import { describe, expect, it } from "vitest";

import {
  defaultFeatureStatuses,
  ReleaseManifestSchema,
  renderReleaseNotes,
} from "../../src/release/index.js";

describe("release notes", () => {
  it("renders release gates and feature statuses", () => {
    const manifest = ReleaseManifestSchema.parse({
      name: "spec-to-pr",
      version: "0.1.0",
      builtAt: "2026-06-28T00:00:00.000Z",
      gitCommit: "a".repeat(40),
      nodeVersion: "v22.0.0",
      packagePath: "/tmp/spec-to-pr-0.1.0.zip",
      packageSha256: `sha256:${"a".repeat(64)}`,
      includedFiles: [".claude-plugin/plugin.json", "dist/mcp/server.js"],
      excludedPatterns: ["node_modules/"],
      pluginValidationStatus: "skipped",
      features: defaultFeatureStatuses(),
    });
    const notes = renderReleaseNotes(manifest);

    expect(notes).toContain("# spec-to-pr 0.1.0");
    expect(notes).toContain("- Archive integrity: verified before publication");
    expect(notes).toContain("v2-facade");
    expect(notes).toContain("delivery-profiles");
    expect(notes).toContain("api-ready");
    expect(notes).toContain("split-review");
    expect(notes).not.toContain("01-08");
    expect(notes).toContain("This task prepares a release candidate only.");
  });
});
